import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
      name: 'terroir-cart',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? window.localStorage : undefined as unknown as Storage)),
      version: 1,
    },
  ),
);
