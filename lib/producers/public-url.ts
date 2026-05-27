import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// Construit l'URL absolue de la fiche publique d'un producteur (cross-
// subdomain : la fiche vit sur www.* alors que l'espace producteur vit sur
// pro.*). Centralise la convention `${NEXT_PUBLIC_APP_URL}/producteurs/{slug}`
// pour ne pas dupliquer la construction d'URL dans le header et la sidebar
// producteur.
export function buildPublicProducerUrl(slug: string): string {
  return `${NEXT_PUBLIC_APP_URL}/producteurs/${slug}`;
}
