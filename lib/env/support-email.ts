// Fail-fast au module-load : pas de fallback silencieux. Cohérent avec le
// pattern lib/env/urls.ts (commit ef7f10b) — un default hardcodé absorberait
// une var manquante et laisserait des emails admin partir vers un destinataire
// non confirmé. On throw à l'import pour que le build/boot/runtime tombe
// bruyamment si la config est incorrecte.
//
// Côté production : SUPPORT_EMAIL doit être set dans Vercel pour les 3 envs
// (Production / Preview / Development). Valeur attendue : adresse de l'inbox
// admin recevant les alertes critiques (transfer.failed, payout.failed,
// charge.dispute.*).
//
// Côté tests : les fichiers de test qui importent indirectement ce module
// doivent set SUPPORT_EMAIL via vi.hoisted() — pattern aligné sur les stubs
// NEXT_PUBLIC_* dans tests/app/api/stripe/webhook/route.test.tsx.

const supportEmail = process.env.SUPPORT_EMAIL;

if (!supportEmail) {
  throw new Error(
    "Missing SUPPORT_EMAIL env variable. Set in Vercel All Environments + .env.local. Expected example value: 'admin@terroir-local.fr'.",
  );
}

if (!supportEmail.includes("@")) {
  throw new Error(
    `Invalid SUPPORT_EMAIL env variable: "${supportEmail}". Expected an email address (e.g. 'admin@terroir-local.fr').`,
  );
}

export const SUPPORT_EMAIL: string = supportEmail;
