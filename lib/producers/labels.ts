export const ESPECE_LABEL: Record<string, string> = {
  bovin: 'Bœuf',
  porcin: 'Porc',
  ovin: 'Agneau',
};

export const LABEL_LABEL: Record<string, string> = {
  label_rouge: 'Label Rouge',
  bio: 'Agriculture Biologique',
  aop: 'AOP',
  boeuf_fermier_maine: 'Bœuf Fermier du Maine',
};

export function labelEspece(v: string): string {
  return ESPECE_LABEL[v] ?? v;
}

export function labelLabel(v: string): string {
  return LABEL_LABEL[v] ?? v;
}
