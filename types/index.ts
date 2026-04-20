export interface Order {
  id: string;
  consumerId: string;
  producerId: string;
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
