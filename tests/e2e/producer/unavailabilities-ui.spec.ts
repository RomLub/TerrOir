/**
 * E2E producer — Indisponibilités /creneaux (ADR-0016).
 *
 * Parcours couvert :
 *   1. Le producteur pose une indisponibilité depuis la nouvelle modale.
 *   2. Le créneau du jour devient invisible côté fiche produit publique.
 *   3. Le producteur retire l'indisponibilité.
 *   4. Le créneau réapparaît côté fiche produit publique.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/test-context';
import { seedProducer, seedProduct } from '../helpers/db-seed';
import { loginAs } from '../helpers/user-lifecycle';
import { getRawAdminClient } from '../helpers/supabase-admin';

const PARIS_TZ = 'Europe/Paris';

function parisDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

function monthIndex(dateKey: string): number {
  const [y, m] = dateKey.split('-').map(Number);
  return y! * 12 + (m! - 1);
}

function weekOffsetFor(date: Date): number {
  const monday = (d: Date) => {
    const c = new Date(d);
    const dow = (c.getDay() + 6) % 7;
    c.setDate(c.getDate() - dow);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  return Math.round(
    (monday(date).getTime() - monday(new Date()).getTime()) / (7 * 86_400_000),
  );
}

async function goToTargetMonth(page: Page, targetDateKey: string) {
  const current = monthIndex(parisDateKey(new Date()));
  const target = monthIndex(targetDateKey);
  const delta = target - current;
  for (let i = 0; i < Math.abs(delta); i++) {
    await page
      .getByRole('button', {
        name: delta > 0 ? 'Mois suivant' : 'Mois précédent',
      })
      .click();
  }
}

async function openUnavailabilityModal(page: Page, targetDateKey: string) {
  await page.getByRole('button', { name: 'Indisponibilité', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Indisponibilité' }),
  ).toBeVisible();
  await goToTargetMonth(page, targetDateKey);
}

function modalDateButton(page: Page, dateKey: string) {
  return page.getByRole('dialog').locator(`button[aria-label^="${dateKey}"]`);
}

test.describe('Producer /creneaux — indisponibilités', () => {
  test('poser puis retirer une indisponibilité masque puis restaure le créneau public', async ({
    page,
    ctx,
  }) => {
    test.setTimeout(90_000);

    const admin = getRawAdminClient();
    const producer = await seedProducer(ctx, {
      suffix: 'unavail-ui',
      statut: 'public',
    });
    const product = await seedProduct(ctx, {
      producerId: producer.producerId,
      nom: 'Produit test indispo',
      active: true,
      stockIllimite: true,
    });

    const slotStart = new Date();
    slotStart.setDate(slotStart.getDate() + 7);
    slotStart.setHours(10, 0, 0, 0);
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(11, 0, 0, 0);
    const targetDateKey = parisDateKey(slotStart);

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

    const publicUrl = `/producteurs/${producer.slug}/produits/${product.id}`;
    await page.goto(publicUrl);
    await expect(page.locator('button[aria-label^="Créneau"]')).toHaveCount(1);

    await loginAs(page, producer.user);
    const offset = weekOffsetFor(slotStart);
    await page.goto(offset === 0 ? '/creneaux' : `/creneaux?week=${offset}`);
    await expect(
      page.getByRole('heading', { name: /Vos créneaux de retrait/i }),
    ).toBeVisible({ timeout: 15_000 });

    await openUnavailabilityModal(page, targetDateKey);
    await modalDateButton(page, targetDateKey).click();
    await page.getByRole('button', { name: 'Poser indispo' }).click();

    await expect.poll(async () => {
      const { data } = await admin
        .from('slots')
        .select('excluded_at')
        .eq('id', slot!.id)
        .single();
      return data?.excluded_at ?? null;
    }).not.toBeNull();

    await page.goto(publicUrl);
    await expect(page.locator('button[aria-label^="Créneau"]')).toHaveCount(0);
    await expect(page.getByText('Aucun créneau disponible')).toBeVisible();

    await page.goto(offset === 0 ? '/creneaux' : `/creneaux?week=${offset}`);
    await openUnavailabilityModal(page, targetDateKey);
    await modalDateButton(page, targetDateKey).click();
    await page.getByRole('button', { name: 'Retirer' }).click();

    await expect.poll(async () => {
      const { data } = await admin
        .from('slots')
        .select('excluded_at')
        .eq('id', slot!.id)
        .single();
      return data ? data.excluded_at : 'missing-slot';
    }).toBeNull();

    await page.goto(publicUrl);
    await expect(page.locator('button[aria-label^="Créneau"]')).toHaveCount(1);
  });
});
