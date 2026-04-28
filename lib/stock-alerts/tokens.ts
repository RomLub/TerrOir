import "server-only";
import { randomBytes } from "crypto";

// Génère un token random 32 chars URL-safe pour confirm/unsubscribe d'alertes
// stock dispo produit. 24 bytes = 192 bits d'entropie, encodés en base64url
// = 32 chars sans padding ni caractère problématique en URL. Stocké en DB
// avec contrainte UNIQUE (cf. migration 20260428200000).
//
// Choix random vs HMAC déterministe (pattern lib/rgpd/opt-out-token.ts) :
// random permet la régénération sur ré-abonnement (cas user resub après
// unsubscribe — voir create-alert.ts). HMAC déterministe ne permet pas de
// révoquer un ancien token sans rotation globale du secret.
export function generateAlertToken(): string {
  return randomBytes(24).toString("base64url");
}
