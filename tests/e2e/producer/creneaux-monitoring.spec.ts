/**
 * E2E producer — Section monitoring des places sur /creneaux (ADR-0014).
 *
 * 3 scenarii :
 *   1. Mode libre : 1 slot cap 4 + 1 commande → 1 case réservée + 3 libres
 *      → clic case réservée → arrive sur /commandes/[id].
 *   2. Mode RDV   : règle 30 min cap 2 sur 9h-11h + 1 commande sur le 2ᵉ
 *      sous-slot → tooltip contient l'heure du sous-slot.
 *   3. Exclusion partielle : 3 sous-slots dont 1 fermé → seuls les sous-slots
 *      actifs apparaissent dans le monitoring (pas de cases du sous-slot fermé).
 *
 * Couverture complémentaire des tests unitaires `group-creneaux-monitoring`
 * et RTL `MonitoringSection` : on vérifie ici la chaîne complète
 * fetch enrichi → grouping → composant → lien commande.
 */

import { test, expect, type Page } from '@playwright/test';
import { test as ctxTest } from '../helpers/test-context';
import { seedProducer, seedConsumer } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';
import { cleanupOrdersForProducers } from '../helpers/order-lifecycle';

const TZ_OFFSET_HOURS = 0; // calculs JS locaux : tous les tests tournent dans
// la même TZ que le serveur Next ; on n'a pas besoin de forcer Europe/Paris.

function mondayOf(d: Date): Date {
  const c = new Date(d);
  const dow = (c.getDay() + 6) % 7;
  c.setDate(c.getDate() - dow);
  c.setHours(0, 0, 0, 0);
  return c;
}

function weekOffsetFor(target: Date): number {
  const m1 = mondayOf(new Date()).getTime();
  const m2 = mondayOf(target).getTime();
  return Math.round((m2 - m1) / (7 * 86_400_000));
}

// Date cible : un jour milieu de semaine, à 5+ jours, pour rester
// confortablement dans une semaine complète (lun→dim) navigable via ?week=.
function buildTargetSlotStart(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  d.setHours(9 + TZ_OFFSET_HOURS, 0, 0, 0);
  return d;
}

async function navigateToCreneauxWeek(page: Page, anyDateInWeek: Date) {
  const offset = weekOffsetFor(anyDateInWeek);
  const url = offset === 0 ? '/creneaux' : `/creneaux?week=${offset}`;
  await page.goto(url);
}

ctxTest.describe('Producer /creneaux — monitoring des places', () => {
  ctxTest('mode libre : case réservée → /commandes/[id]', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);
    const admin = getRawAdminClient();

    const producer = await seedProducer(ctx, {
      suffix: 'mon-libre',
      statut: 'public',
    });
    const consumer = await seedConsumer(ctx, { suffix: 'mon-libre-c' });
    await admin
      .from('users')
      .update({ prenom: 'Lucie' })
      .eq('id', consumer.id);

    const slotStart = buildTargetSlotStart();
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(slotEnd.getHours() + 3);

    const { data: slot, error: slotErr } = await admin
      .from('slots')
      .insert({
        producer_id: producer.producerId,
        rule_id: null,
        starts_at: slotStart.toISOString(),
        ends_at: slotEnd.toISOString(),
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
        date_retrait: slotStart.toISOString().slice(0, 10),
        heure_retrait: '09:00',
        statut: 'pending',
        montant_total: 9.99,
      })
      .select('id, code_commande')
      .single();
    expect(orderErr, orderErr?.message).toBeNull();

    try {
      await loginAs(page, producer.user);
      await navigateToCreneauxWeek(page, slotStart);

      const section = page.getByTestId('monitoring-section');
      await expect(section).toBeVisible({ timeout: 15_000 });

      // 1 bloc, cap 4 → 1 case pleine + 3 libres
      const reserved = section.getByTestId('monitoring-cell-reserved');
      const free = section.getByTestId('monitoring-cell-free');
      await expect(reserved).toHaveCount(1);
      await expect(free).toHaveCount(3);

      // Le lien pointe vers /commandes/{id}
      await expect(reserved.first()).toHaveAttribute(
        'href',
        `/commandes/${order!.id}`,
      );

      // Tooltip en mode libre : "TRR-XXX · Lucie"
      const aria = await reserved.first().getAttribute('aria-label');
      expect(aria).toContain(order!.code_commande);
      expect(aria).toContain('Lucie');
      expect(aria).not.toMatch(/\b\d{1,2}h/); // pas d'heure en mode libre

      // Clic → page détail commande
      await reserved.first().click();
      await page.waitForURL(new RegExp(`/commandes/${order!.id}$`));
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  ctxTest('mode RDV : tooltip avec heure du sous-slot', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);
    const admin = getRawAdminClient();

    const producer = await seedProducer(ctx, {
      suffix: 'mon-rdv',
      statut: 'public',
    });
    const consumer = await seedConsumer(ctx, { suffix: 'mon-rdv-c' });
    await admin
      .from('users')
      .update({ prenom: 'Hugo' })
      .eq('id', consumer.id);

    const base = buildTargetSlotStart();
    // 4 sous-slots de 30 min : 9h, 9h30, 10h, 10h30
    const subSlots = [0, 30, 60, 90].map((offsetMin) => {
      const s = new Date(base);
      s.setMinutes(s.getMinutes() + offsetMin);
      const e = new Date(s.getTime() + 30 * 60_000);
      return { start: s, end: e };
    });

    // Insert rule (pour que mode='rdv' soit explicitement déclaré).
    const { data: rule, error: ruleErr } = await admin
      .from('slot_rules')
      .insert({
        producer_id: producer.producerId,
        days_of_week: [(base.getDay() + 6) % 7], // ISO 0=lundi
        periodicity_weeks: 1,
        start_time: '09:00',
        end_time: '11:00',
        slot_duration_minutes: 30,
        capacity_per_slot: 2,
        mode: 'rdv',
        active: true,
      })
      .select('id')
      .single();
    expect(ruleErr, ruleErr?.message).toBeNull();

    // Insert 4 sous-slots manuellement (rattachés à la rule).
    const insertedSlots: { id: string; starts_at: string }[] = [];
    for (const { start, end } of subSlots) {
      const { data, error } = await admin
        .from('slots')
        .insert({
          producer_id: producer.producerId,
          rule_id: rule!.id,
          starts_at: start.toISOString(),
          ends_at: end.toISOString(),
          capacity_per_slot: 2,
          active: true,
        })
        .select('id, starts_at')
        .single();
      expect(error, error?.message).toBeNull();
      insertedSlots.push(data!);
    }

    // 1 commande sur le 2ᵉ sous-slot (9h30).
    const target = insertedSlots[1]!;
    const targetStart = new Date(target.starts_at);
    const { data: order, error: orderErr } = await admin
      .from('orders')
      .insert({
        producer_id: producer.producerId,
        consumer_id: consumer.id,
        slot_id: target.id,
        date_retrait: targetStart.toISOString().slice(0, 10),
        heure_retrait: `${String(targetStart.getHours()).padStart(2, '0')}:${String(targetStart.getMinutes()).padStart(2, '0')}`,
        statut: 'confirmed',
        montant_total: 12.5,
      })
      .select('id, code_commande')
      .single();
    expect(orderErr, orderErr?.message).toBeNull();

    try {
      await loginAs(page, producer.user);
      await navigateToCreneauxWeek(page, base);

      const section = page.getByTestId('monitoring-section');
      await expect(section).toBeVisible({ timeout: 15_000 });

      // Bloc unique : 4 sous-slots × cap 2 = 8 cases ; 1 réservée, 7 libres.
      const reserved = section.getByTestId('monitoring-cell-reserved');
      const free = section.getByTestId('monitoring-cell-free');
      await expect(reserved).toHaveCount(1);
      await expect(free).toHaveCount(7);

      // Tooltip : "9h30 · TRR-XXX · Hugo"
      const aria = await reserved.first().getAttribute('aria-label');
      expect(aria).toMatch(/^9h30 · /);
      expect(aria).toContain(order!.code_commande);
      expect(aria).toContain('Hugo');

      // Badge durée
      const duration = section.getByTestId('block-duration').first();
      await expect(duration).toHaveText('RDV 30 min');
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });

  ctxTest('exclusion partielle : sous-slots fermés absents du monitoring', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(60_000);
    const admin = getRawAdminClient();

    const producer = await seedProducer(ctx, {
      suffix: 'mon-excl',
      statut: 'public',
    });

    const base = buildTargetSlotStart();
    // 3 sous-slots ponctuels cap 3, contigus.
    const subSlots = [
      [0, 60],
      [60, 120],
      [120, 180],
    ].map(([sOff, eOff]) => {
      const s = new Date(base);
      s.setMinutes(s.getMinutes() + sOff!);
      const e = new Date(base);
      e.setMinutes(e.getMinutes() + eOff!);
      return { start: s, end: e };
    });

    const insertedIds: string[] = [];
    for (let i = 0; i < subSlots.length; i++) {
      const { start, end } = subSlots[i]!;
      const payload: Record<string, unknown> = {
        producer_id: producer.producerId,
        rule_id: null,
        starts_at: start.toISOString(),
        ends_at: end.toISOString(),
        capacity_per_slot: 3,
        active: true,
      };
      // Le sous-slot du milieu (10h-11h) est exclu.
      if (i === 1) {
        payload.excluded_at = new Date().toISOString();
      }
      const { data, error } = await admin
        .from('slots')
        .insert(payload)
        .select('id')
        .single();
      expect(error, error?.message).toBeNull();
      insertedIds.push(data!.id);
    }

    try {
      await loginAs(page, producer.user);
      await navigateToCreneauxWeek(page, base);

      const section = page.getByTestId('monitoring-section');
      await expect(section).toBeVisible({ timeout: 15_000 });

      // Le sous-slot exclu retire ses 3 cases. Les 2 sous-slots actifs
      // restent contigus (9h-10h + 11h-12h) — non, ils ne sont PAS contigus
      // (le sous-slot 10h-11h est exclu, mais la contiguïté est 9h→10h et
      // 11h→12h sans connecteur 10h-11h). Donc 2 blocs distincts : 9h-10h
      // et 11h-12h, chacun cap 3 → 6 cases libres au total.
      const free = section.getByTestId('monitoring-cell-free');
      await expect(free).toHaveCount(6);

      // 2 blocs distincts dans la journée.
      const blocks = section.getByTestId('monitoring-block');
      await expect(blocks).toHaveCount(2);
    } finally {
      await cleanupOrdersForProducers([producer.producerId]);
    }
  });
});
