// Test rendu conditionnel de la section "Validation du retrait" sur la
// page detail commande producer. Couvre le mini-fix du gate :
// `status === 'confirmed'` (modèle 3 états réel).
//
// Cluster C — T6 cleanup : 'ready' a été retiré du modèle (CHECK
// orders.statut + union TS). Le test sur status='ready' est obsolète.
//
// Pattern SSR static (renderToStaticMarkup) suffisant : le test porte sur
// le branch initial du conditionnel, pas sur des interactions stateful.
// Cohérent avec tests/app/(admin)/admin-sidebar.test.tsx.

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Hoisted pour précéder les imports applicatifs qui valident la présence
// d'env vars au load (pattern aligné avec tests/app/api/orders/[id]/complete).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

import {
  OrderDetailClient,
  type OrderDetailData,
} from "@/app/(producer)/commandes/[id]/OrderDetailClient";
import type { OrderStatus } from "@/components/ui";

function makeData(status: OrderStatus): OrderDetailData {
  return {
    id: "order-test",
    numeroCommande: "0042-00001",
    client: { name: "Marie Dupont", email: "marie@test.fr", phone: "0600000000" },
    createdAtLabel: "3 mai 2026",
    slotDate: "Demain",
    slotTime: "10h–12h",
    items: [{ name: "Saucisson sec", qty: "1 pièce", unitPrice: 8, total: 8 }],
    subtotal: 8,
    commission: 0.48,
    total: 8,
    status,
  };
}

function render(data: OrderDetailData): string {
  return renderToStaticMarkup(<OrderDetailClient data={data} />);
}

describe("OrderDetailClient producer — gate section 'Validation du retrait'", () => {
  it("affiche un retour vers la liste des commandes", () => {
    const html = render(makeData("confirmed"));
    expect(html).toContain('href="/commandes"');
    expect(html).toContain("Mes commandes");
  });

  it("status='confirmed' → section visible (modèle 3 états : pickup direct)", () => {
    const html = render(makeData("confirmed"));
    expect(html).toContain("Validation du retrait");
    expect(html).toContain("TRR-XXXXX");
    expect(html).toContain("Valider le retrait");
  });

  it("status='pending' → section masquée (commande pas encore confirmée)", () => {
    const html = render(makeData("pending"));
    expect(html).not.toContain("Validation du retrait");
    expect(html).not.toContain("Valider le retrait");
  });

  it("status='completed' → section masquée + message 'Commande finalisée'", () => {
    const html = render(makeData("completed"));
    expect(html).not.toContain("Validation du retrait");
    expect(html).toContain("Commande finalisée");
  });

  it("status='cancelled' → section masquée + message 'annulée'", () => {
    const html = render(makeData("cancelled"));
    expect(html).not.toContain("Validation du retrait");
    expect(html).toContain("annulée");
  });
});
