import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { Shield, BarChart3, FileAudio, Users, AlertTriangle, ArrowLeft, ShieldAlert, Coins } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/admin", label: "Overview", icon: BarChart3, end: true },
  { to: "/admin/economy", label: "Credit economy", icon: Coins, end: false },
  { to: "/admin/abuse", label: "Abuse", icon: ShieldAlert, end: false },
  { to: "/admin/documents", label: "Documents & cache", icon: FileAudio, end: false },
  { to: "/admin/users", label: "Users & roles", icon: Users, end: false },
  { to: "/admin/errors", label: "Error log", icon: AlertTriangle, end: false },
];

export default function AdminLayout() {
  const location = useLocation();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <span className="font-display text-lg font-bold">Admin</span>
          </div>
          <Link to="/dashboard" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back to app
          </Link>
        </div>
      </header>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
        <nav className="space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                  isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <l.icon className="w-4 h-4" /> {l.label}
            </NavLink>
          ))}
        </nav>
        <div key={location.pathname}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}
