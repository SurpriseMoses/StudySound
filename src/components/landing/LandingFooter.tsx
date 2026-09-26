import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export default function LandingFooter() {
  return (
    <footer className="border-t py-10">
      <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="font-display font-bold">StudySound</span>
        </div>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
          <Link to="/support" className="hover:text-foreground">Support</Link>
        </nav>
        <p className="text-sm text-muted-foreground">© 2026 StudySound. Built for learners, by learners.</p>
      </div>
    </footer>
  );
}
