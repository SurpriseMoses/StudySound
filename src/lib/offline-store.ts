/**
 * Offline storage for lessons (text + audio) using IndexedDB.
 * Everything here is device-local; nothing is synced back.
 */

const DB_NAME = "studysound-offline";
const DB_VERSION = 1;

export type OfflineBook = {
  id: string; // document_id
  title: string;
  subject: string | null;
  language: string;
  totalChunks: number;
  audioChunks: number;
  bytes: number;
  savedAt: number;
};

export type OfflineChunk = {
  key: string; // `${documentId}:${chunkIndex}`
  documentId: string;
  chunkIndex: number;
  text: string;
};

type OfflineAudio = {
  key: string; // `${documentId}:${language}:${chunkIndex}`
  documentId: string;
  chunkIndex: number;
  language: string;
  blob: Blob;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("books")) {
        db.createObjectStore("books", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("chunks")) {
        const s = db.createObjectStore("chunks", { keyPath: "key" });
        s.createIndex("documentId", "documentId", { unique: false });
      }
      if (!db.objectStoreNames.contains("audio")) {
        const s = db.createObjectStore("audio", { keyPath: "key" });
        s.createIndex("documentId", "documentId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export const offlineSupported = typeof indexedDB !== "undefined";

export async function listBooks(): Promise<OfflineBook[]> {
  if (!offlineSupported) return [];
  try {
    const all = await tx<OfflineBook[]>("books", "readonly", (s) => s.getAll() as IDBRequest<OfflineBook[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function getBook(documentId: string): Promise<OfflineBook | null> {
  if (!offlineSupported) return null;
  try {
    const b = await tx<OfflineBook | undefined>("books", "readonly", (s) => s.get(documentId) as IDBRequest<OfflineBook | undefined>);
    return b ?? null;
  } catch {
    return null;
  }
}

export async function saveBook(book: OfflineBook): Promise<void> {
  await tx("books", "readwrite", (s) => s.put(book));
}

export async function putChunks(documentId: string, chunks: { chunk_index: number; text: string }[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("chunks", "readwrite");
    const store = t.objectStore("chunks");
    for (const c of chunks) {
      const row: OfflineChunk = {
        key: `${documentId}:${c.chunk_index}`,
        documentId,
        chunkIndex: c.chunk_index,
        text: c.text ?? "",
      };
      store.put(row);
    }
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
}

export async function getChunks(documentId: string): Promise<OfflineChunk[]> {
  if (!offlineSupported) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction("chunks", "readonly");
    const req = t.objectStore("chunks").index("documentId").getAll(documentId);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as OfflineChunk[]).sort((a, b) => a.chunkIndex - b.chunkIndex));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putAudio(documentId: string, language: string, chunkIndex: number, blob: Blob): Promise<void> {
  const row: OfflineAudio = { key: `${documentId}:${language}:${chunkIndex}`, documentId, language, chunkIndex, blob };
  await tx("audio", "readwrite", (s) => s.put(row));
}

export async function getAudioBlob(documentId: string, language: string, chunkIndex: number): Promise<Blob | null> {
  if (!offlineSupported) return null;
  try {
    const row = await tx<OfflineAudio | undefined>("audio", "readonly", (s) =>
      s.get(`${documentId}:${language}:${chunkIndex}`) as IDBRequest<OfflineAudio | undefined>,
    );
    return row?.blob ?? null;
  } catch {
    return null;
  }
}

export async function deleteBook(documentId: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(["books", "chunks", "audio"], "readwrite");
    t.objectStore("books").delete(documentId);
    for (const store of ["chunks", "audio"] as const) {
      const idx = t.objectStore(store).index("documentId");
      const cursorReq = idx.openCursor(IDBKeyRange.only(documentId));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    }
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
