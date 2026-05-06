import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// T-266-bis : nouvelle cle namespace doctrine T-266 (underscore).
// Ancienne cle 'terroir-cart' (tiret) lue en fallback + migree au passage
// (cf. storage adapter ci-dessous). Suppression fallback legacy programmee
// apres 2026-06-05 (T-266-tris).
const CART_KEY = 'terroir_cart';
const CART_KEY_LEGACY = 'terroir-cart';

// Storage adapter custom : zustand persist passe par getItem/setItem/removeItem
// au lieu d'un .setItem direct. Le helper createMigratedStorage ne s'applique
// pas tel quel ici (zustand attend une signature key-aware). On reproduit la
// logique inline.
const cartStorageAdapter: Storage = {
  get length() {
    return typeof window !== 'undefined' ? window.localStorage.length : 0;
  },
  clear() {
    if (typeof window !== 'undefined') window.localStorage.clear();
  },
  key(index: number): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.key(index);
  },
  getItem(name: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
      // Pour la cle cart, lit d'abord la nouvelle, fallback sur l'ancienne +
      // migration. Pour toute autre cle, comportement standard localStorage.
      if (name !== CART_KEY) return window.localStorage.getItem(name);
      const newVal = window.localStorage.getItem(CART_KEY);
      if (newVal !== null) return newVal;
      const legacyVal = window.localStorage.getItem(CART_KEY_LEGACY);
      if (legacyVal === null) return null;
      window.localStorage.setItem(CART_KEY, legacyVal);
      window.localStorage.removeItem(CART_KEY_LEGACY);
      return legacyVal;
    } catch {
      return null;
    }
  },
  setItem(name: string, value: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(name, value);
      if (name === CART_KEY) {
        window.localStorage.removeItem(CART_KEY_LEGACY);
      }
    } catch {
      // quota / mode prive : fail-silent.
    }
  },
  removeItem(name: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(name);
      if (name === CART_KEY) {
        window.localStorage.removeItem(CART_KEY_LEGACY);
      }
    } catch {
      // fail-silent.
    }
  },
};

export type CartItem = {
  productId: string;
  producerId: string;
  slug: string;
  nom: string;
  prix: number;
  unite: string;
  quantite: number;
  creneauId: string;
  dateRetrait: string;
  producerName?: string;
  image?: string | null;
};

type CartKey = Pick<CartItem, 'productId' | 'creneauId' | 'dateRetrait'>;

function sameLine(a: CartItem, b: CartKey): boolean {
  return (
    a.productId === b.productId &&
    a.creneauId === b.creneauId &&
    a.dateRetrait === b.dateRetrait
  );
}

type CartState = {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  removeItem: (key: CartKey) => void;
  updateQuantity: (key: CartKey, quantite: number) => void;
  clear: () => void;
};

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((state) => {
          const idx = state.items.findIndex((i) => sameLine(i, item));
          if (idx === -1) return { items: [...state.items, item] };
          const next = state.items.slice();
          next[idx] = { ...next[idx], quantite: next[idx].quantite + item.quantite };
          return { items: next };
        }),
      removeItem: (key) =>
        set((state) => ({ items: state.items.filter((i) => !sameLine(i, key)) })),
      updateQuantity: (key, quantite) =>
        set((state) => {
          if (quantite <= 0) {
            return { items: state.items.filter((i) => !sameLine(i, key)) };
          }
          return {
            items: state.items.map((i) => (sameLine(i, key) ? { ...i, quantite } : i)),
          };
        }),
      clear: () => set({ items: [] }),
    }),
    {
      name: CART_KEY,
      storage: createJSONStorage(() => cartStorageAdapter),
      version: 1,
    },
  ),
);
