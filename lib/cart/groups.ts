import type { CartItem } from "@/lib/store/cart";

export type CartOrderGroup = {
  id: string;
  producerId: string;
  slug: string;
  producerName: string;
  slotId: string;
  dateRetrait: string;
  items: CartItem[];
};

export function cartGroupId(item: {
  producerId: string;
  creneauId: string;
  dateRetrait: string;
}): string {
  return `${item.producerId}|${item.creneauId}|${item.dateRetrait}`;
}

export function groupCartItems(items: readonly CartItem[]): CartOrderGroup[] {
  const groups = new Map<string, CartOrderGroup>();

  for (const item of items) {
    const id = cartGroupId(item);
    const group = groups.get(id);

    if (group) {
      group.items.push(item);
      continue;
    }

    groups.set(id, {
      id,
      producerId: item.producerId,
      slug: item.slug,
      producerName: item.producerName ?? "Producteur",
      slotId: item.creneauId,
      dateRetrait: item.dateRetrait,
      items: [item],
    });
  }

  return Array.from(groups.values());
}

export function removeCartGroupItems(
  items: readonly CartItem[],
  groupId: string,
): CartItem[] {
  return items.filter((item) => cartGroupId(item) !== groupId);
}
