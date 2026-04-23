// Types partagés entre l'endpoint /api/cart/validate et ses consommateurs
// (page panier + page checkout). La clé d'item est `${productId}|${creneauId}|
// ${dateRetrait}` — identique à celle utilisée pour dédupliquer les lignes
// dans lib/store/cart.ts (sameLine) et pour grouper par commande au checkout.

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
  | "slot_full";

export type ItemStatus =
  | { ok: true }
  | { ok: false; fatal: true; reason: FatalReason }
  | { ok: false; fatal: false; reason: "stock_insufficient"; maxQuantite: number };

export type ValidateResponse = {
  results: Record<string, ItemStatus>;
};

export function itemKey(item: {
  productId: string;
  creneauId: string;
  dateRetrait: string;
}): string {
  return `${item.productId}|${item.creneauId}|${item.dateRetrait}`;
}
