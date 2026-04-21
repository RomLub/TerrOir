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
import type { UserRole } from "@/lib/auth/roles";

export interface ProducerLite {
  id: string;
  slug: string;
  nom_exploitation: string;
  statut: string;
}

export interface UserContextValue {
  user: User | null;
  producer: ProducerLite | null;
  roles: UserRole[];
  isAdmin: boolean;
  loading: boolean;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  producer: null,
  roles: [],
  isAdmin: false,
  loading: true,
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [producer, setProducer] = useState<ProducerLite | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(currentUser: User | null) {
      if (!currentUser) {
        if (!cancelled) {
          setRoles([]);
          setIsAdmin(false);
          setProducer(null);
        }
        return;
      }

      const [userRes, adminRes, producerRes] = await Promise.all([
        supabase
          .from("users")
          .select("roles")
          .eq("id", currentUser.id)
          .maybeSingle(),
        supabase
          .from("admin_users")
          .select("id")
          .eq("id", currentUser.id)
          .maybeSingle(),
        supabase
          .from("producers")
          .select("id, slug, nom_exploitation, statut")
          .eq("user_id", currentUser.id)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      setRoles((userRes.data?.roles as UserRole[] | undefined) ?? []);
      setIsAdmin(!!adminRes.data);
      setProducer((producerRes.data as ProducerLite | null) ?? null);
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const current = data.session?.user ?? null;
        setUser(current);
        loadProfile(current).finally(() => {
          if (!cancelled) setLoading(false);
        });
      })
      .catch((err) => {
        console.error("[UserProvider] getSession failed:", err);
        if (!cancelled) setLoading(false);
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
    () => ({ user, producer, roles, isAdmin, loading }),
    [user, producer, roles, isAdmin, loading],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext() {
  return useContext(UserContext);
}
