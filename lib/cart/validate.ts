// Types partagés entre l'endpoint /api/cart/validate et ses consommateurs
// (page panier + page checkout). La clé d'item est `${productId}|${creneauId}|
// ${dateRetrait}` — identique à celle utilisée pour dédupliquer les lignes
// dans lib/store/cart.ts (sameLine) et pour grouper par commande au checkout.
//
// T-449 wontfix : la clé n'inclut PAS `quantite` ni `producerId` par
// design — alignement intentionnel avec sameLine() du store cart.ts qui
// dédoublonne en amont par tuple (productId, creneauId, dateRetrait).
// Conséquence : le state cart.items ne peut JAMAIS contenir 2 lignes
// avec même clé (addItem agrège la quantité au lieu de dupliquer, cf
// lib/store/cart.ts:40-47). Collision impossible via UI normale.
//
// Scénario malicious sans risque : un client crafting un POST direct
// /api/cart/validate avec 2 items dupliqués se mute lui-même (la 2e
// itération écrase la 1ère dans results[key]) — read-only, pas
// d'impact plateforme. Pour orders/create, la contrainte SQL côté DB
// (UNIQUE order_items + RPC create_order_with_items) empêche toute
// duplication persistée. Test H3 dans tests/app/api/cart/validate/
// route.test.ts:528 fige le comportement actuel pour anti-régression.

export type CartItemInput = {
  productId: string;
  producerId: string;
  creneauId: string;
  dateRetrait: string;
  quantite: number;
};

export type FatalReason =
  | "producer_unavailable"
  | "product_unavailable"
  | "slot_unavailable"
  | "product_slot_unavailable"
  | "slot_full";

export type ItemStatus =
  | { ok: true }
  | { ok: false; fatal: true; reason: FatalReason }
  | { ok: false; fatal: false; reason: "stock_insufficient"; maxQuantite: number };

export type ValidateResponse = {
  results: Record<string, ItemStatus>;
  slotCompatibility?: {
    hasSlotConflict: boolean;
    compatibleSlots: Record<string, string[]>;
  };
};

export function itemKey(item: {
  productId: string;
  creneauId: string;
  dateRetrait: string;
}): string {
  return `${item.productId}|${item.creneauId}|${item.dateRetrait}`;
}
