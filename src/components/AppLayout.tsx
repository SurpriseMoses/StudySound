import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  BookOpen, Upload, Headphones, Image, Brain, Library,
  CreditCard, User, Menu, X, Home, Sparkles, Shield, LogOut
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DailyRewardProvider } from "@/contexts/DailyRewardContext";
import DailyRewardModal from "@/components/DailyRewardModal";
import { useDailyRewardContext } from "@/contexts/DailyRewardContext";
import StreakActivePill from "@/components/StreakActivePill";
import { ProgressionProvider, useProgressionContext } from "@/contexts/ProgressionContext";
import LevelUpModal from "@/components/LevelUpModal";
import LevelXpBar from "@/components/LevelXpBar";
import FreeCreditsExpiryBadge from "@/components/FreeCreditsExpiryBadge";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: Home },
  { path: "/subjects", label: "Subjects", icon: BookOpen },
  { path: "/upload", label: "Upload", icon: Upload },
  { path: "/library", label: "Library", icon: Library },
  { path: "/plans", label: "Plans", icon: CreditCard },
  { path: "/profile", label: "Profile", icon: User },
];

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { isAdmin } = useIsAdmin();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { open, result, dismiss } = useDailyRewardContext();
  const { reload: reloadProgression, flushLevelUp } = useProgressionContext();

  // After a fresh daily reward, refetch XP/level (server bumps both) and surface any queued level-up.
  useEffect(() => {
    if (result && !result.alreadyClaimed) {
      reloadProgression().then(() => {
        // Small delay so the reward modal has its moment first
        setTimeout(flushLevelUp, 3200);
      });
    }
  }, [result, reloadProgression, flushLevelUp]);

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/auth");
  };

  return (
    <div className="min-h-screen flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-foreground/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar text-sidebar-foreground flex flex-col transition-transform duration-300 lg:translate-x-0 lg:static",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-5 flex items-center gap-3 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-sidebar-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">StudySound</span>
          <button className="ml-auto lg:hidden text-sidebar-foreground" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                )}
              >
                <item.icon className="w-4.5 h-4.5" />
                {item.label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              to="/admin"
              onClick={() => setSidebarOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors mt-2 border-t border-sidebar-border pt-3",
                location.pathname.startsWith("/admin")
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
              )}
            >
              <Shield className="w-4.5 h-4.5" />
              Admin
            </Link>
          )}
        </nav>

        <div className="p-4 border-t border-sidebar-border space-y-2">
          <LevelXpBar variant="sidebar" />
          <div className="bg-sidebar-accent rounded-lg p-3 space-y-2">
            <FreeCreditsExpiryBadge className="w-full justify-center" />
            <Link to="/plans">
              <Button size="sm" className="w-full bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 text-xs">
                Upgrade Plan
              </Button>
            </Link>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="w-full justify-start text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden sticky top-0 z-30 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5 text-foreground" />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-display font-bold">StudySound</span>
          </div>
          <div className="ml-auto">
            <FreeCreditsExpiryBadge />
          </div>
        </header>

        <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      <DailyRewardModal open={open} result={result} onClose={dismiss} />
      <StreakActivePill />
      <LevelUpModal />
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProgressionProvider>
      <DailyRewardProvider>
        <AppLayoutInner>{children}</AppLayoutInner>
      </DailyRewardProvider>
    </ProgressionProvider>
  );
}
