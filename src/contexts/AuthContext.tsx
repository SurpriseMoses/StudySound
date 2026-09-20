import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    // THEN check existing session
    supabase.auth.getSession().then(({ data: { session: existing } }) => {
      setSession(existing);
      setUser(existing?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Safety net: if subjects were picked during sign-up but never landed on the
  // profile (older accounts), copy them across once the user is signed in.
  useEffect(() => {
    if (!user) return;
    const fromSignup = (user.user_metadata?.selected_subjects ?? []) as string[];
    if (!Array.isArray(fromSignup) || fromSignup.length === 0) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("selected_subjects")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data && (!data.selected_subjects || data.selected_subjects.length === 0)) {
        await supabase
          .from("profiles")
          .update({ selected_subjects: fromSignup, onboarding_completed: true })
          .eq("user_id", user.id);
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
