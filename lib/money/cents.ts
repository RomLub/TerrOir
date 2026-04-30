// T-415 : helpers cents pour précision arithmétique sur montants money.
// Évite les erreurs IEEE 754 cumulées (ex: 0.1 + 0.2 = 0.30000000000000004).
// Convention : tous les calculs critiques (Stripe API + aggregations) passent
// en entiers cents côté JS. DB reste en numeric (précision arbitraire DB-side).
// Aligné Stripe SDK qui utilise toujours integer cents (amount: 1500 = 15.00€).

export function eurosToCents(euros: number | string): number {
  return Math.round(Number(euros) * 100);
}

export function centsToEuros(cents: number): number {
  return cents / 100;
}

export function sumCents(values: ReadonlyArray<number | string>): number {
  return values.reduce<number>((acc, v) => acc + eurosToCents(v), 0);
}
