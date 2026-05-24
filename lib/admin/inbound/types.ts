// Chantier 9 — types de la boîte mails admin (emails entrants).

export type InboundTag = "producteur" | "consommateur" | "public";

export const INBOUND_TAGS: InboundTag[] = ["producteur", "consommateur", "public"];

export const INBOUND_TAG_LABEL: Record<InboundTag, string> = {
  producteur: "Producteurs",
  consommateur: "Consommateurs",
  public: "Public",
};

export type InboundEmailRow = {
  id: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string | null;
  tag: InboundTag;
  lookupUserId: string | null;
  lookupLeadId: string | null;
  readAt: string | null;
  repliedAt: string | null;
};
