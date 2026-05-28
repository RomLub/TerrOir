/**
 * E2E producer — Garde anti-régression ADR-0015.
 *
 * Vérifie que le `code_commande` (preuve de remise, format TRR-XXXXX) ne
 * fuite PAS dans le HTML rendu côté producteur en pré-remise (statut
 * confirmed → completed). Le seul endroit où le producteur peut voir le
 * code après le fix est `PickupValidationCard` POST-saisie (le producteur
 * vient de le taper, pas une fuite).
 *
 * Surfaces parcourues :
 *   - /commandes              (liste)
 *   - /commandes/[id]         (détail) — sans saisir de code
 *   - /dashboard              (carte prochain retrait + commandes pending)
 *   - /creneaux               (grille d'ajout + section monitoring)
 *
 * Chaque page est chargée après seed d'une commande au statut `confirmed`
 * (= preuve encore non consommée, fuite-sensible). L'assert : aucun motif
 * `TRR-{5 chars}` dans le HTML rendu.
 */

import { expect, type Page } from '@playwright/test';
import { test as ctxTest } from '../helpers/test-context';
import { seedProducer, seedConsumer } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';

const PICKUP_CODE_REGEX = /TRR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}/g;

async function assertNoPickupCode(page: Page, where: string) {
  const html = await page.content();
  const matches = html.match(PICKUP_CODE_REGEX);
  expect(
    matches,
    `${where} : code_commande (TRR-XXXXX) ne doit jamais apparaître côté producteur en pré-remise (ADR-0015). Trouvé : ${JSON.stringify(matches)}`,
  ).toBeNull();
}

ctxTest.describe('ADR-0015 — code_commande ne fuite pas côté producteur', () => {
  ctxTest('aucun TRR- visible sur /commandes, /commandes/[id], /dashboard, /creneaux', async ({
    page,
    ctx,
  }) => {
    ctxTest.setTimeout(90_000);
    const admin = getRawAdminClient();

    const producer = await seedProducer(ctx, {
      suffix: 'noleak',
      statut: 'public',
    });
    const consumer = await seedConsumer(ctx, { suffix: 'noleak-c' });

    // Slot futur + order confirmed (preuve encore non consommée).
    const start = new Date();
    start.setDate(start.getDate() + 3);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(11, 0, 0, 0);

    const { data: slot, error: slotErr } = await admin
      .from('slots')
      .insert({
        producer_id: producer.producerId,
        rule_id: null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        capacity_per_slot: 4,
        active: true,
      })
      .select('id')
      .single();
    expect(slotErr, slotErr?.message).toBeNull();

    const { data: order, error: orderErr } = await admin
      .from('orders')
      .insert({
        producer_id: producer.producerId,
        consumer_id: consumer.id,
        slot_id: slot!.id,
        date_retrait: start.toISOString().slice(0, 10),
        heure_retrait: '10:00',
        statut: 'confirmed',
        montant_total: 15.0,
      })
      .select('id, code_commande')
      .single();
    expect(orderErr, orderErr?.message).toBeNull();
    expect(order!.code_commande).toMatch(PICKUP_CODE_REGEX);

    try {
      await loginAs(page, producer.user);

      // 1. Liste commandes
      await page.goto('/commandes');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
        timeout: 15_000,
      });
      await assertNoPickupCode(page, '/commandes (liste)');

      // 2. Détail commande
      await page.goto(`/commandes/${order!.id}`);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
        timeout: 15_000,
      });
      await assertNoPickupCode(page, '/commandes/[id] (détail)');

      // 3. Dashboard
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
        timeout: 15_000,
      });
      await assertNoPickupCode(page, '/dashboard');

      // 4. Créneaux (grille ajout + monitoring section)
      await page.goto('/creneaux');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
        timeout: 15_000,
      });
      await assertNoPickupCode(page, '/creneaux');
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});
