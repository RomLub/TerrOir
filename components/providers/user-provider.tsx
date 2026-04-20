"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type UserRole = "consumer" | "producer" | "admin";

export interface ProducerLite {
  id: string;
  slug: string;
  nom_exploitation: string;
  statut: string;
}

export interface UserContextValue {
  user: User | null;
  producer: ProducerLite | null;
  role: UserRole | null;
  loading: boolean;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  producer: null,
  role: null,
  loading: true,
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [producer, setProducer] = useState<ProducerLite | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(currentUser: User | null) {
      if (!currentUser) {
        if (!cancelled) {
          setRole(null);
          setProducer(null);
        }
        return;
      }

      const [{ data: profile }, { data: producerRow }] = await Promise.all([
        supabase
          .from("users")
          .select("role")
          .eq("id", currentUser.id)
          .maybeSingle(),
        supabase
          .from("producers")
          .select("id, slug, nom_exploitation, statut")
          .eq("user_id", currentUser.id)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      setRole((profile?.role as UserRole | undefined) ?? null);
      setProducer((producerRow as ProducerLite | null) ?? null);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const current = data.session?.user ?? null;
      setUser(current);
      loadProfile(current).finally(() => {
        if (!cancelled) setLoading(false);
      });
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const current = session?.user ?? null;
        setUser(current);
        loadProfile(current);
      },
    );

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const value: UserContextValue = useMemo(
    () => ({ user, producer, role, loading }),
    [user, producer, role, loading],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext() {
  return useContext(UserContext);
}
