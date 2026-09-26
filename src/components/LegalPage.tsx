import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export interface LegalSection { title: string; body: string[] }

export default function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: LegalSection[] }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to StudySound
        </Link>
        <h1 className="font-display text-3xl font-bold mb-2">{title}</h1>
        <p className="text-sm text-muted-foreground mb-2">Last updated: {updated}</p>
        <p className="text-xs rounded-md border bg-muted px-3 py-2 text-muted-foreground mb-8">
          Draft document. Company details and contact information will be added before launch.
        </p>
        {sections.map((s) => (
          <section key={s.title} className="mb-6">
            <h2 className="font-display text-xl font-semibold mb-2">{s.title}</h2>
            {s.body.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-foreground/90 mb-2">{p}</p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
