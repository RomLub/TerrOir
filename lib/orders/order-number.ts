// Numéro de commande producteur-facing. Format `PPPP-CCCCC` où :
//   - PPPP = producer_number (4 chiffres, séquentiel d'inscription producteur)
//   - CCCCC = producer_order_seq (5 chiffres, séquentiel commande par producteur)
//
// Distinct du code_commande (`TRR-XXXXX` ou `TRR-XXXXXXX`) qui est la preuve de remise et ne
// doit JAMAIS être affiché côté producteur avant que le client le présente
// (cf. ADR-0015 + lib/orders/pickup-validation.ts).

const PRODUCER_PAD = 4;
const SEQ_PAD = 5;

export function formatOrderNumber(
  producerNumber: number,
  producerOrderSeq: number,
): string {
  return `${String(producerNumber).padStart(PRODUCER_PAD, "0")}-${String(
    producerOrderSeq,
  ).padStart(SEQ_PAD, "0")}`;
}

export function formatProducerNumber(producerNumber: number): string {
  return String(producerNumber).padStart(PRODUCER_PAD, "0");
}
