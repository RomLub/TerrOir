import { describe, it, expect } from 'vitest';
import { CATEGORIES_WITH_ANIMAL } from '@/lib/products/categories-with-animal';

describe('CATEGORIES_WITH_ANIMAL', () => {
  it("contient 'viande'", () => {
    expect(CATEGORIES_WITH_ANIMAL).toContain('viande');
  });

  it("contient 'charcuterie'", () => {
    expect(CATEGORIES_WITH_ANIMAL).toContain('charcuterie');
  });

  it("ne contient pas 'legumes' (catégorie sans espèce animale)", () => {
    expect(CATEGORIES_WITH_ANIMAL).not.toContain('legumes');
  });

  it('expose une liste de 2 entrées (forme attendue par les pages producteur)', () => {
    // Note : `readonly string[]` côté type empêche les mutations dans le code
    // consommateur via tsc. Pas de Object.freeze runtime — la garantie est au
    // niveau TS uniquement. Ce test verrouille juste la longueur, pour
    // détecter une régression accidentelle (ajout silencieux d'une catégorie).
    expect(Array.isArray(CATEGORIES_WITH_ANIMAL)).toBe(true);
    expect(CATEGORIES_WITH_ANIMAL.length).toBe(2);
  });
});
