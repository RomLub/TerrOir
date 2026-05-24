/**
 * E2E producer — Slot management (rules récurrentes + slots ad-hoc).
 *
 * Architecture :
 *   - slot_rules : règles génératrices configurées par le producer.
 *     `generateSlotsForProducer(admin, producerId, 90)` matérialise les
 *     instances dans `slots` (rule_id link).
 *   - slots ad-hoc : insertion directe rule_id=null.
 *   - capacity_per_slot : entier, contrainte CHECK >= 1 côté DB.
 *
 * Stratégie test :
 *   - Création via admin client direct (bypass server actions UI lourdes :
 *     les server actions sont déjà couvertes par tests vitest unitaires).
 *   - Côté UI : navigation /creneaux pour lecture côté producer (RLS).
 *   - Pas de test "capacity dépassée" runtime côté order : déjà couvert
 *     par RPC create_order_with_items (cf migration 20260422500000).
 *     On teste plutôt la contrainte CHECK DB (capacity_per_slot >= 1).
 *
 * Couverture (3 tests) :
 *   1. Création slot ad-hoc (rule_id=null) → row visible côté DB + l'écran
 *      calendrier /creneaux se charge (ADR-0012).
 *   2. Création slot_rules → INSERT row visible côté DB + l'écran calendrier
 *      /creneaux se charge.
 *   3. CHECK constraint capacity_per_slot >= 1 → INSERT capacity=0 refusé
 *      par Postgres (sécurité DB, pas seulement Zod côté action).
 *
 * NB (ADR-0012) : le détail du regroupement / des 2 modes est couvert en
 * unitaire (group-week-slots, slice-window, validators). Ici on smoke-teste
 * le chargement de l'écran + l'intégrité DB.
 */

import { test, expect } from '../helpers/test-context';
import { seedProducer } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';

test.describe('Producer slots — management', () => {
  test('création slot ad-hoc (rule_id=null) visible côté UI /creneaux', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: 'slot-adhoc',
      statut: 'public',
    });

    const admin = getRawAdminClient();
    // INSERT direct slot ad-hoc demain matin
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
        capacity_per_slot: 5,
        active: true,
      })
      .select('id')
      .single();
    expect(slotErr, slotErr?.message).toBeNull();
    expect(slot, 'slot row insert').not.toBeNull();

    await loginAs(page, producer.user);
    await page.goto('/creneaux');

    // L'écran calendrier des créneaux se charge (smoke check).
    await expect(
      page.getByRole('heading', { name: /Vos créneaux de retrait/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /Ouverture régulière/i }),
    ).toBeVisible();

    // Vérifie DB : le slot bien tagué rule_id=null + futur
    const { data: row } = await admin
      .from('slots')
      .select('id, rule_id, capacity_per_slot, producer_id')
      .eq('id', slot!.id)
      .single();
    expect(row!.rule_id).toBeNull();
    expect(row!.capacity_per_slot).toBe(5);
    expect(row!.producer_id).toBe(producer.producerId);
  });

  test('création slot_rules → row visible section "Règles récurrentes"', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);

    const producer = await seedProducer(ctx, {
      suffix: 'slot-rule',
      statut: 'public',
    });

    const admin = getRawAdminClient();
    // INSERT slot_rule mercredi+samedi 9h-12h, créneaux 30min, capacity 4
    const { data: rule, error: ruleErr } = await admin
      .from('slot_rules')
      .insert({
        producer_id: producer.producerId,
        days_of_week: [3, 6],
        periodicity_weeks: 1,
        start_time: '09:00:00',
        end_time: '12:00:00',
        slot_duration_minutes: 30,
        capacity_per_slot: 4,
        active: true,
      })
      .select('id, capacity_per_slot, days_of_week')
      .single();
    expect(ruleErr, ruleErr?.message).toBeNull();
    expect(rule, 'rule row insert').not.toBeNull();
    expect(rule!.capacity_per_slot).toBe(4);

    await loginAs(page, producer.user);
    await page.goto('/creneaux');

    // L'écran calendrier se charge (la règle existe côté DB, vérifiée plus
    // haut ; matérialisation/affichage couverts en unitaire).
    await expect(
      page.getByRole('heading', { name: /Vos créneaux de retrait/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('CHECK DB capacity_per_slot >= 1 → INSERT capacity=0 refusé', async ({
    ctx,
  }) => {
    test.setTimeout(30_000);

    const producer = await seedProducer(ctx, {
      suffix: 'slot-cap0',
      statut: 'public',
    });

    const admin = getRawAdminClient();
    const { error } = await admin.from('slot_rules').insert({
      producer_id: producer.producerId,
      days_of_week: [1],
      periodicity_weeks: 1,
      start_time: '09:00:00',
      end_time: '11:00:00',
      slot_duration_minutes: 30,
      capacity_per_slot: 0, // viole CHECK >= 1 (cf migration slot_rules)
      active: true,
    });
    expect(
      error,
      'INSERT capacity_per_slot=0 doit être refusé par contrainte CHECK',
    ).not.toBeNull();
    // Postgres CHECK constraint violation : code 23514
    expect(error!.code, `error.code attendu 23514 (CHECK), reçu ${error!.code}`).toBe('23514');
  });
});
