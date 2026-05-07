import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIVE_ORDER_STATUTS } from "@/lib/orders/stateMachine";

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 text-terroir-muted"
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function OrdersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 text-terroir-green-700"
      aria-hidden
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 text-terroir-green-700"
      aria-hidden
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 text-terroir-green-700"
      aria-hidden
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 text-terroir-green-700"
      aria-hidden
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  );
}

type CardProps = {
  href?: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
};

function SectionCard({ href, icon, title, description, disabled }: CardProps) {
  const inner = (
    <div className="flex items-start gap-4">
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0 flex-1">
        <h2 className="font-serif text-lg text-terroir-green-700">{title}</h2>
        <p className="mt-0.5 text-sm text-terroir-muted">{description}</p>
      </div>
      {!disabled ? <ChevronIcon /> : null}
    </div>
  );

  if (disabled || !href) {
    return (
      <div className="rounded-2xl border border-dashed border-terroir-border bg-white/40 p-5 opacity-60">
        {inner}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-terroir-border bg-white p-5 shadow-sm transition hover:border-terroir-green-700/30 hover:shadow-md"
    >
      {inner}
    </Link>
  );
}

export default async function ComptePage() {
  const session = await getSessionUser();
  if (!session) redirect("/connexion");

  const supabase = await createSupabaseServerClient();
  const [{ data: profile }, { count: activeOrders }] = await Promise.all([
    supabase
      .from("users")
      .select("prenom")
      .eq("id", session.id)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("consumer_id", session.id)
      .in("statut", [...ACTIVE_ORDER_STATUTS]),
  ]);

  const prenom = profile?.prenom?.trim() || "";
  const orderCount = activeOrders ?? 0;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-terra-700">
          Mon compte
        </p>
        <h1 className="mt-2 font-serif text-[40px] leading-tight text-terroir-green-700">
          Bienvenue{prenom ? `, ${prenom}` : ""}
        </h1>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <SectionCard
          href="/compte/commandes"
          icon={<OrdersIcon />}
          title="Mes commandes"
          description={
            orderCount > 0
              ? `${orderCount} commande${orderCount > 1 ? "s" : ""} en cours`
              : "Suivi et historique"
          }
        />
        <SectionCard
          href="/compte/profil"
          icon={<ProfileIcon />}
          title="Mon profil"
          description="Coordonnées et préférences"
        />
        <SectionCard
          href="/compte/password"
          icon={<LockIcon />}
          title="Mot de passe"
          description="Sécurité du compte"
        />
        <SectionCard
          href="/compte/paiements"
          icon={<CardIcon />}
          title="Moyens de paiement"
          description="Tes cartes enregistrées"
        />
      </div>
    </div>
  );
}
