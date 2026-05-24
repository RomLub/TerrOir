"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useCartStore } from "@/lib/store/cart";

// Bouton panier (icône + compteur) partagé entre la navbar publique
// (NavbarPublic) et la barre du compte acheteur (ConsumerHeader). Extrait pour
// éviter la duplication. Deux variantes : "desktop" (icône + libellé + badge)
// et "mobile" (icône carrée + badge superposé).

export type CartVariant = "desktop" | "mobile";

function ShoppingBagIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M6 2 L3 6 v14 a2 2 0 0 0 2 2 h14 a2 2 0 0 0 2 -2 V6 L18 2 Z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10 a4 4 0 0 1 -8 0" />
    </svg>
  );
}

export function CartNavButton({ variant }: { variant: CartVariant }) {
  // Mounted pattern : évite le flash visuel quand persist hydrate le store
  // Zustand depuis localStorage après le 1er render client. SSR / 1er render
  // client = état count=0 → après mount, count réel apparaît.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const count = useCartStore((s) => s.items.length);
  const show = mounted && count > 0;
  const display = count > 99 ? "99+" : String(count);
  const ariaLabel =
    count > 0
      ? `Mon panier (${count} article${count > 1 ? "s" : ""})`
      : "Mon panier";

  if (variant === "mobile") {
    return (
      <Link
        href="/compte/panier"
        aria-label={ariaLabel}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md bg-terra-700 text-white transition-colors hover:bg-terra-800 focus:outline-none focus:ring-2 focus:ring-terra-700 focus:ring-offset-2"
      >
        <ShoppingBagIcon className="h-5 w-5" />
        {show ? (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold tabular-nums text-terra-700 shadow-sm"
          >
            {display}
          </span>
        ) : null}
      </Link>
    );
  }

  return (
    <Link
      href="/compte/panier"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-2 rounded-md bg-terra-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-terra-800 focus:outline-none focus:ring-2 focus:ring-terra-700 focus:ring-offset-2"
    >
      <ShoppingBagIcon className="h-5 w-5" />
      <span>Panier</span>
      {show ? (
        <span
          aria-hidden="true"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-semibold tabular-nums text-terra-700"
        >
          {display}
        </span>
      ) : null}
    </Link>
  );
}
