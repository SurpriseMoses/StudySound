import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/admin/quiz-bank", label: "Overview", end: true },
  { to: "/admin/quiz-bank/questions", label: "Question Bank", end: false },
  { to: "/admin/quiz-bank/jobs", label: "Seed Jobs", end: false },
  { to: "/admin/quiz-bank/review", label: "Review Queue", end: false },
  { to: "/admin/quiz-bank/templates", label: "Quiz Templates", end: false },
  { to: "/admin/quiz-bank/curriculum", label: "Curriculum & Assessment", end: false },
  { to: "/admin/quiz-bank/settings", label: "Quiz Settings", end: false },
];

export default function QuizBankLayout() {
  const location = useLocation();
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Brain className="w-5 h-5 text-accent" />
        <h1 className="font-display text-2xl font-bold">Quiz Bank</h1>
      </div>

      <div className="-mx-1 overflow-x-auto">
        <nav className="flex gap-1 px-1 min-w-max border-b pb-2">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cn(
                  "px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div key={location.pathname}>
        <Outlet />
      </div>
    </div>
  );
}
