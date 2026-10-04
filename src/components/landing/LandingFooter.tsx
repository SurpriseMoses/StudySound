import { Link } from "react-router-dom";

export default function LandingFooter() {
  return (
    <footer className="border-t py-10">
      <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <img src="/icon-192.png" alt="BrainGrasp logo" className="w-6 h-6 rounded" />
          <span className="font-display font-bold">BrainGrasp — a product of AcademInnovate</span>
        </div>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/terms" className="hover:text-foreground">Terms</Link>
          <Link to="/support" className="hover:text-foreground">Support</Link>
        </nav>
        <div className="text-center md:text-right text-sm text-muted-foreground">
          <a href="mailto:braingrasp.ai@gmail.com" className="hover:text-foreground">braingrasp.ai@gmail.com</a>
          <p>© 2026 AcademInnovate. Built for learners.</p>
        </div>
      </div>
    </footer>
  );
}
