import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useIsAdmin() {
  const { user, loading: authLoading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!user) { setIsAdmin(false); setLoading(false); return; }
    setLoading(true);

    const check = async () => {
      // Retry a few times so a transient backend hiccup doesn't hide the admin UI forever.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data, error } = await supabase
            .from("user_roles")
            .select("id")
            .eq("user_id", user.id)
            .eq("role", "admin")
            .maybeSingle();
          if (cancelled) return;
          if (!error) {
            setIsAdmin(!!data);
            setLoading(false);
            return;
          }
        } catch {
          // network failure — fall through to retry
        }
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      if (!cancelled) setLoading(false);
    };

    check();
    return () => { cancelled = true; };
  }, [user, authLoading]);


  return { isAdmin, loading };
}
