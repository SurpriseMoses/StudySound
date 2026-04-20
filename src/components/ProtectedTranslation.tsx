import { useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";

const MAX_SELECTION_CHARS = 400;
const COPY_HINT_THROTTLE_MS = 6000;

interface Props {
  text: string;
  className?: string;
}

/**
 * Renders translated text with soft anti-abuse friction:
 *  - blocks right-click on the block
 *  - blocks Ctrl/Cmd+A within the block
 *  - truncates clipboard payload to MAX_SELECTION_CHARS and appends a notice
 *  - shows a friendly hint on rapid copy attempts
 *
 * Does NOT block normal short copies (notes, quotes ≤400 chars work fine).
 */
export function ProtectedTranslation({ text, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHintAt = useRef(0);
  const [copyAttempts, setCopyAttempts] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      maybeHint("Right-click is disabled on translations. Select a small section to copy notes.");
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Block Select-All inside the protected block
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        const sel = window.getSelection();
        if (sel && el.contains(sel.anchorNode)) {
          e.preventDefault();
          maybeHint("Copy smaller sections for notes.");
        }
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      const sel = window.getSelection()?.toString() ?? "";
      if (!sel) return;
      setCopyAttempts((n) => n + 1);

      if (sel.length > MAX_SELECTION_CHARS) {
        e.preventDefault();
        const truncated =
          sel.slice(0, MAX_SELECTION_CHARS) +
          `…\n\n[StudySound — for personal study use only]`;
        e.clipboardData?.setData("text/plain", truncated);
        maybeHint(`Copied first ${MAX_SELECTION_CHARS} characters. Copy smaller sections for notes.`);
      } else {
        // Append a small attribution to short copies too
        e.preventDefault();
        e.clipboardData?.setData(
          "text/plain",
          sel + `\n— StudySound (personal study)`,
        );
      }
    };

    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("copy", onCopy);
    return () => {
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("copy", onCopy);
    };
  }, []);

  const maybeHint = (msg: string) => {
    const now = Date.now();
    if (now - lastHintAt.current < COPY_HINT_THROTTLE_MS) return;
    lastHintAt.current = now;
    toast({ title: "Heads up", description: msg });
  };

  // Soft cooldown after many rapid copy attempts in one mount
  useEffect(() => {
    if (copyAttempts >= 8) {
      maybeHint("We're slowing things slightly to keep the system fair for everyone.");
    }
  }, [copyAttempts]);

  return (
    <div
      ref={ref}
      tabIndex={0}
      className={className}
      style={{
        // Allow text selection but discourage drag-image
        WebkitUserDrag: "none",
        userSelect: "text",
      } as React.CSSProperties}
      // The translated text from the edge function already includes:
      //  - an invisible zero-width watermark (after first sentence)
      //  - a visible "— StudySound · {name} · for personal study only" footer
    >
      {text}
    </div>
  );
}
