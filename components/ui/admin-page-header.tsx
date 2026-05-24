import { PageHeader, type PageHeaderProps } from "./page-header";

// Header partagé des pages admin (Phase B4 consolidation). Depuis la refonte
// de l'espace producteur (ADR-0011), le composant générique vit dans
// `page-header.tsx` (prop `tone`). On conserve `AdminPageHeader` comme alias
// rétro-compatible figé sur tone="admin" → les ~10 pages admin existantes et
// le barrel ne changent pas.

export type AdminPageHeaderProps = Omit<PageHeaderProps, "tone">;

export function AdminPageHeader(props: AdminPageHeaderProps) {
  return <PageHeader {...props} tone="admin" />;
}
