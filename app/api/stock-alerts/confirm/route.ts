import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { confirmStockAlert } from "@/lib/stock-alerts/confirm-alert";
import { NEXT_PUBLIC_APP_URL } from "@/lib/env/urls";

// 2-step opt-in pour résister aux prefetchers email (Outlook Safe Links,
// Gmail Image Proxy, Microsoft ATP, Mimecast, Proofpoint) qui scannent les
// liens à la livraison : un GET ne déclenche plus l'effet — il renvoie un
// form HTML qui doit être soumis explicitement par l'utilisateur. Pattern
// aligné avec app/(public)/desabonnement (RGPD).
//
// GET /api/stock-alerts/confirm?token=xxx
//   → renvoie une page HTML avec form POST (token en input hidden).
// POST /api/stock-alerts/confirm  (form-encoded, body: token=xxx)
//   → exécute confirmStockAlert puis redirect 303 vers
//     /alertes-stock/confirm?status=<...>.
//
// Idempotence préservée : re-clic = helper renvoie already_confirmed=true.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConfirmPage(token: string): string {
  const safeToken = escapeHtml(token);
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Confirmer mon alerte stock — TerrOir</title>
<meta name="robots" content="noindex,nofollow" />
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8f5ee; color: #1a1a1a; }
  main { max-width: 32rem; margin: 0 auto; padding: 5rem 1.5rem; }
  h1 { font-size: 2rem; line-height: 1.2; color: #14532d; margin: 0 0 1rem; font-family: Georgia, serif; }
  p { font-size: 0.95rem; line-height: 1.6; color: #4a4a4a; margin: 0 0 1.5rem; }
  button { background: #14532d; color: #fff; border: 0; border-radius: 0.5rem;
           padding: 0.85rem 1.5rem; font-size: 1rem; font-weight: 600; cursor: pointer; }
  button:hover { background: #166534; }
</style>
</head>
<body>
<main>
  <h1>Confirmer mon alerte stock</h1>
  <p>
    Pour activer votre alerte, cliquez sur le bouton ci-dessous. Vous recevrez
    un email dès que le produit sera de nouveau disponible.
  </p>
  <form method="post" action="/api/stock-alerts/confirm">
    <input type="hidden" name="token" value="${safeToken}" />
    <button type="submit">Confirmer mon alerte</button>
  </form>
</main>
</body>
</html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  return new Response(renderConfirmPage(token), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  const token = String(formData?.get("token") ?? "").trim();

  const admin = createSupabaseAdminClient();
  const result = await confirmStockAlert(admin, token);

  let status: string;
  if (result.ok) {
    status = result.data.already_confirmed ? "already_confirmed" : "success";
  } else {
    status = result.error === "db_error" ? "invalid" : result.error;
  }

  const target = `${NEXT_PUBLIC_APP_URL}/alertes-stock/confirm?status=${encodeURIComponent(status)}`;
  return NextResponse.redirect(target, { status: 303 });
}
