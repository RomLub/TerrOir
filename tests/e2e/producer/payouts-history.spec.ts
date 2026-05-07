/**
 * E2E producer/revenus — affichage payouts producer.
 *
 * Couverture (2 tests) :
 *   1. /revenus liste les payouts dans l'historique : seed 2 payouts
 *      (paid + processing) → vu dans le tableau "Historique des
 *      virements" avec montants formatés et badges statut.
 *   2. RLS isolation revenus : payout du producer B n'apparaît jamais
 *      sur /revenus du producer A (filter explicite producer_id côté
 *      Server Component).
 *
 * Pas de page detail /revenus/[id] dans le repo courant — on teste
 * uniquement la liste et l'isolation.
 *
 * Cleanup : INSERT direct payouts via raw admin (pas tracké par
 * trackRowId car FK payouts.producer_id ON DELETE NO ACTION nécessite
 * cleanup explicite en finally avant cleanupAllTrackedUsers afterEach).
 */

import { test, expect } from "../helpers/test-context";
import { seedProducer } from "../helpers/db-seed";
import { loginAs } from "../helpers/user-lifecycle";
import { getRawAdminClient } from "../helpers/supabase-admin";

async function insertPayout(args: {
  producerId: string;
  statut: "pending" | "processing" | "paid" | "failed";
  montantBrut: number;
  commission: number;
  montantNet: number;
  periodeDebut: string; // YYYY-MM-DD
  periodeFin: string;
  stripePayoutId?: string;
}): Promise<string> {
  const admin = getRawAdminClient();
  const { data, error } = await admin
    .from("payouts")
    .insert({
      producer_id: args.producerId,
      statut: args.statut,
      montant_brut: args.montantBrut,
      commission: args.commission,
      montant_net: args.montantNet,
      periode_debut: args.periodeDebut,
      periode_fin: args.periodeFin,
      stripe_payout_id: args.stripePayoutId ?? null,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`insertPayout failed: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

async function cleanupPayoutsForProducers(producerIds: string[]): Promise<void> {
  if (producerIds.length === 0) return;
  const admin = getRawAdminClient();
  await admin.from("payouts").delete().in("producer_id", producerIds);
}

test.describe("Producer — Revenus / Payouts (/revenus)", () => {
  test("liste payouts paid + processing dans l'historique", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producer = await seedProducer(ctx, {
      suffix: "payt-list",
      statut: "public",
    });

    try {
      // Seed 2 payouts historiques (statut != pending → apparaissent
      // dans le tableau "Historique des virements" cf. revenus/page.tsx:67).
      await insertPayout({
        producerId: producer.producerId,
        statut: "paid",
        montantBrut: 120.5,
        commission: 7.23,
        montantNet: 113.27,
        periodeDebut: "2026-04-20",
        periodeFin: "2026-04-26",
        stripePayoutId: "po_test_payt_paid_001",
      });
      await insertPayout({
        producerId: producer.producerId,
        statut: "processing",
        montantBrut: 80.0,
        commission: 4.8,
        montantNet: 75.2,
        periodeDebut: "2026-04-27",
        periodeFin: "2026-05-03",
      });

      await loginAs(page, producer.user);
      await page.goto("/revenus");

      await expect(
        page.getByRole("heading", { name: "Vos revenus", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /Historique des virements/i }),
      ).toBeVisible();

      // Montants nets formatés FR (virgule + symbole €). Locator par
      // role=cell pour scoper à la table (anti-collision avec hero
      // "Prochain virement" + flake résiduels run précédentes).
      await expect(
        page.getByRole("cell", { name: "113,27 €", exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "75,20 €", exact: true }).first(),
      ).toBeVisible();

      // Badges statut (cf. mapStatusToBadge) : "Viré" pour paid,
      // "Virement en cours" pour processing. exact:true sur "Viré"
      // sinon strict mode violation contre la colonne header "Net viré".
      // .first() pour absorber d'éventuels résiduels d'une run précédente.
      await expect(
        page.getByText("Viré", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText(/Virement en cours/i).first(),
      ).toBeVisible();
    } finally {
      await cleanupPayoutsForProducers([producer.producerId]);
    }
  });

  test("RLS isolation : producer A ne voit pas le payout de producer B", async ({
    page,
    ctx,
  }) => {
    test.setTimeout(120_000);

    const producerA = await seedProducer(ctx, {
      suffix: "payt-rls-a",
      statut: "public",
    });
    const producerB = await seedProducer(ctx, {
      suffix: "payt-rls-b",
      statut: "public",
    });

    try {
      // Marqueurs distinctifs : 2 montants nets uniques, jamais 0 pour
      // éviter collision avec d'autres payouts de la DB de test.
      const distinctNetA = 333.33;
      const distinctNetB = 444.44;

      await insertPayout({
        producerId: producerA.producerId,
        statut: "paid",
        montantBrut: 350.0,
        commission: 16.67,
        montantNet: distinctNetA,
        periodeDebut: "2026-04-13",
        periodeFin: "2026-04-19",
        stripePayoutId: "po_test_payt_rls_a",
      });
      await insertPayout({
        producerId: producerB.producerId,
        statut: "paid",
        montantBrut: 460.0,
        commission: 15.56,
        montantNet: distinctNetB,
        periodeDebut: "2026-04-13",
        periodeFin: "2026-04-19",
        stripePayoutId: "po_test_payt_rls_b",
      });

      await loginAs(page, producerA.user);
      await page.goto("/revenus");

      // A voit son montant unique, jamais celui de B. Locator par cell
      // (table) — résilient aux résiduels d'une run précédente où la
      // même valeur pourrait apparaître hors-table (ex: hero "Prochain
      // virement"). exact match empêche aussi le strict-mode violation
      // si plusieurs nodes affichent la même string.
      await expect(
        page.getByRole("cell", { name: "333,33 €", exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("cell", { name: "444,44 €", exact: true }),
      ).toHaveCount(0);
    } finally {
      await cleanupPayoutsForProducers([
        producerA.producerId,
        producerB.producerId,
      ]);
    }
  });
});
