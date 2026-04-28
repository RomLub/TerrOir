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
import type { InitialUserPayload, ProducerLite } from "@/lib/auth/types";

export type { ProducerLite };

export interface UserContextValue {
  user: User | null;
  producer: ProducerLite | null;
  roles: UserRole[];
  isAdmin: boolean;
  isProducer: boolean;
  loading: boolean;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  producer: null,
  roles: [],
  isAdmin: false,
  isProducer: false,
  loading: true,
});

const EMPTY_INITIAL: InitialUserPayload = {
  user: null,
  isAdmin: false,
  isProducer: false,
  producerLite: null,
};

export function UserProvider({
  children,
  initial = EMPTY_INITIAL,
}: {
  children: React.ReactNode;
  initial?: InitialUserPayload;
}) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [user, setUser] = useState<User | null>(initial.user);
  const [roles, setRoles] = useState<UserRole[]>([]);
  // isAdmin / isProducer / producerLite SSR fournis par layout root via
  // getInitialUserPayload() — élimine le flash badge Admin et le flash
  // placeholder ProducerLayout au hard refresh. loadProfile rafraîchit les
  // valeurs ensuite (couvre promotion/démotion en cours de session).
  const [isAdmin, setIsAdmin] = useState(initial.isAdmin);
  const [isProducer, setIsProducer] = useState(initial.isProducer);
  const [producer, setProducer] = useState<ProducerLite | null>(
    initial.producerLite,
  );
  // loading reflète le chargement profile/roles/producer côté client.
  // Si SSR a fourni un user, on doit encore résoudre roles/producer → true.
  // Sinon (anonyme) il n'y a rien à charger → false.
  const [loading, setLoading] = useState(initial.user !== null);

  // Sync state quand un nouveau initial.user arrive via SSR re-render.
  // Cas typique : login server action → redirect("/compte") déclenche une
  // RSC nav client-side ; revalidatePath("/", "layout") re-rend RootLayout
  // côté SSR avec initial.user=Romain, mais useState(initial.user) ligne 50
  // ne re-évalue PAS sa valeur initiale après le premier mount sur
  // /connexion (où initial.user était null). Sans ce sync, le state client
  // garde user=null → navbar affiche "Connexion" alors que le HTML SSR
  // contenait déjà le prénom. Hard refresh fixait (full reload re-instancie
  // UserProvider). Le précédent fix revalidatePath (PR #13) corrigeait le
  // SSR mais pas la sémantique useState.
  //
  // Dépendances primitives (id) uniquement : `initial` est recréé à chaque
  // render parent ; dépendre de l'objet entier ferait re-tirer à chaque
  // render. Comparer initial.user?.id capture les transitions login
  // (null → id) et logout (id → null) sans bruit. Couvre aussi un éventuel
  // bug similaire sur les autres flows post-auth (signup, etc.).
  //
  // loading n'est pas re-set ici : le useEffect onAuthStateChange ci-dessous
  // gère déjà setLoading(false) après loadProfile. Roles n'est pas couvert
  // par initial (loadProfile only) — limitation pré-existante hors scope.
  useEffect(() => {
    setUser(initial.user);
    setIsAdmin(initial.isAdmin);
    setIsProducer(initial.isProducer);
    setProducer(initial.producerLite);
    // Deps primitives volontaires (id) : `initial` est recréé à chaque
    // render parent (RSC update). Dépendre des objets entiers ferait
    // re-tirer à chaque update sans changement d'identité. Comparer les
    // primitives capture précisément les transitions login/logout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initial.user?.id,
    initial.isAdmin,
    initial.isProducer,
    initial.producerLite?.id,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(currentUser: User | null) {
      if (!currentUser) {
        if (!cancelled) {
          setRoles([]);
          setIsAdmin(false);
          setIsProducer(false);
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
      const producerData = (producerRes.data as ProducerLite | null) ?? null;
      setProducer(producerData);
      setIsProducer(producerData !== null);
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
    () => ({ user, producer, roles, isAdmin, isProducer, loading }),
    [user, producer, roles, isAdmin, isProducer, loading],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext() {
  return useContext(UserContext);
}
