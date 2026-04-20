export type UserRole = "consumer" | "producer" | "admin";

export interface User {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface Producer {
  id: string;
  userId: string;
  displayName: string;
  slug: string;
  bio?: string;
  latitude?: number;
  longitude?: number;
}

export interface Product {
  id: string;
  producerId: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  stock: number;
  images: string[];
}

export interface Order {
  id: string;
  consumerId: string;
  producerId: string;
  items: OrderItem[];
  totalCents: number;
  status:
    | "pending"
    | "confirmed"
    | "ready"
    | "completed"
    | "cancelled"
    | "refunded";
  createdAt: string;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}
