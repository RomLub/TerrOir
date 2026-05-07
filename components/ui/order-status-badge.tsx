import type { Order } from "@/types";
import { Badge, type BadgeProps } from "./badge";

export type OrderStatus = Order["status"];

export type OrderStatusBadgeProps = Omit<BadgeProps, "tone" | "children"> & {
  status: OrderStatus;
};

const labels: Record<OrderStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  completed: "Retirée",
  cancelled: "Annulée",
  refunded: "Remboursée",
};

const tones: Record<OrderStatus, BadgeProps["tone"]> = {
  pending: "neutral",
  confirmed: "terra",
  completed: "gray",
  cancelled: "danger",
  refunded: "gray",
};

export function OrderStatusBadge({ status, ...props }: OrderStatusBadgeProps) {
  return (
    <Badge tone={tones[status]} {...props}>
      {labels[status]}
    </Badge>
  );
}
