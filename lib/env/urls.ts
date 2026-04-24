// Fail-fast au module-load : pas de fallback silencieux "localhost" en prod.
// Leçon apprise (commit ef7f10b) : un "?? 'http://localhost:3000'" absorbe une
// var manquante et laisse Stripe/Resend/emails pointer sur localhost sans
// signal. On throw à l'import — le build/boot tombe bruyamment.
//
// Les NEXT_PUBLIC_* sont inlinées par Next.js au build côté client ; si la
// var est présente au build, l'expression `!appUrl` devient dead-code et le
// throw est éliminé du bundle. Si absente, le build casse — ce qui est le
// comportement voulu.

const appUrl = process.env.NEXT_PUBLIC_APP_URL;
if (!appUrl) {
  throw new Error("Missing NEXT_PUBLIC_APP_URL env variable");
}

const producerUrl = process.env.NEXT_PUBLIC_PRODUCER_URL;
if (!producerUrl) {
  throw new Error("Missing NEXT_PUBLIC_PRODUCER_URL env variable");
}

export const NEXT_PUBLIC_APP_URL: string = appUrl;
export const NEXT_PUBLIC_PRODUCER_URL: string = producerUrl;
