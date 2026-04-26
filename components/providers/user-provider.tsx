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

export function UserProvider({
  children,
  initialUser = null,
}: {
  children: React.ReactNode;
  initialUser?: User | null;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(initialUser);
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [producer, setProducer] = useState<ProducerLite | null>(null);
  // loading reflète le chargement profile/roles/producer côté client.
  // Si SSR a fourni un user, on doit encore résoudre roles/producer → true.
  // Sinon (anonyme) il n'y a rien à charger → false.
  const [loading, setLoading] = useState(initialUser !== null);

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

    // onAuthStateChange émet INITIAL_SESSION dès l'abonnement → couvre la
    // résolution initiale, plus tous les login/logout ultérieurs (multi-tab,
    // expiration token). Pas besoin d'appel getSession() séparé.
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const current = session?.user ?? null;
        setUser(current);
        loadProfile(current).finally(() => {
          if (!cancelled) setLoading(false);
        });
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
