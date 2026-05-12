// Test F-001 — RLS UPDATE bloqué côté authenticated owner
// (audit pré-launch 2026-05-10, finding CRITIQUE #1).
//
// Cible : policy `orders service_role update only` USING=false WITH CHECK=false
// (rôle authenticated). Conséquence : aucun UPDATE direct PostgREST n'est
// possible côté consumer ou producer authentifié. Toutes les transitions
// orders passent obligatoirement par des RPC SECURITY DEFINER (cancel_order,
// confirm_order_by_producer, complete_pickup_by_producer, etc.) qui
// EXECUTE côté service_role bypass RLS.
//
// IMPORTANT : ce test verrouille la critique #1 de l'audit pré-launch (bypass
// complet du paiement Stripe via PATCH /orders?id=eq.<own>). Sans lui, un
// futur refactor de la policy (ex: réintroduire un USING=consumer_id=auth.uid()
// pour permettre les notes_client owner) ouvrirait le bypass complet sans
// alerte. La lecture pg_policy côté audit verif 2026-05-11 ne couvre PAS
// la régression.
//
// Comportement attendu (PostgREST + RLS USING=false) : le UPDATE retourne
// success HTTP 200 mais 0 row affecté. Pas d'erreur, mais pas non plus de
// modification. C'est la sémantique standard PostgreSQL.
//
// Pré-requis : `npx supabase start`.

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  getSqlIntegrationClient,
  isLocalSupabaseReachable,
} from "./helpers/client";
import {
  seedAuthenticatedClient,
  cleanupAuthenticatedSession,
  type AuthenticatedSession,
} from "./helpers/auth";

const SUPABASE = getSqlIntegrationClient();

// =============================================================================
// Seed inline producer (autonome vs helpers/seed.ts master cassé).
//
// Pourquoi inline : helpers/seed.ts master a un drift structurel cumulé
// (colonne email obsolète + colonne slug NOT NULL manquante + INSERT
// public.users manquant pour la FK producers_user_id_fkey). Plutôt que de
// payer ces dettes en cascade dans le helper master, on isole les seeds de
// ce test régression F-001 pour les rendre autonomes.
//
// Doctrine : la dette infra master sera traitée en ticket dédié post-Live.
// =============================================================================

type ProducerRef = { userId: string; producerId: string };

async function seedProducerInline(opts?: {
  statut?: string;
}): Promise<ProducerRef> {
  const email = `f001-prod-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const { data: authData, error: authErr } = await SUPABASE.auth.admin
    .createUser({
      email,
      password: "test-password-F001-inline",
      email_confirm: true,
    });
  if (authErr || !authData.user) {
    throw new Error(`seedProducerInline createUser: ${authErr?.message}`);
  }
  const userId = authData.user.id;

  // INSERT miroir public.users (FK producers.user_id → public.users(id)).
  const { error: userErr } = await SUPABASE.from("users").insert({
    id: userId,
    email,
    roles: ["consumer", "producer"],
  });
  if (userErr) {
    await SUPABASE.auth.admin.deleteUser(userId);
    throw new Error(`seedProducerInline public.users: ${userErr.message}`);
  }

  const slug = `f001-prod-${crypto.randomUUID().slice(0, 8)}`;
  const { data: prod, error: prodErr } = await SUPABASE
    .from("producers")
    .insert({
      user_id: userId,
      slug,
      statut: opts?.statut ?? "draft",
      nom_exploitation: "Ferme test F-001",
    })
    .select("id")
    .single();
  if (prodErr || !prod) {
    await SUPABASE.from("users").delete().eq("id", userId);
    await SUPABASE.auth.admin.deleteUser(userId);
    throw new Error(`seedProducerInline producers: ${prodErr?.message}`);
  }

  return { userId, producerId: prod.id };
}

async function cleanupProducerInline(ref: ProducerRef): Promise<void> {
  await SUPABASE.from("producers").delete().eq("id", ref.producerId);
  await SUPABASE.from("users").delete().eq("id", ref.userId);
  await SUPABASE.auth.admin.deleteUser(ref.userId);
}

const reachable = await isLocalSupabaseReachable();
const describeIfLocal = reachable ? describe : describe.skip;

// CHECK constraint orders_code_commande_format_check :
// ^TRR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$
// Charset Crockford-like (sans 0/O/1/I/L/U), aligné avec
// la RPC generate_order_code en prod.
const CODE_COMMANDE_CHARSET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function randomCommandeCode(): string {
  let suffix = "";
  for (let i = 0; i < 7; i++) {
    suffix += CODE_COMMANDE_CHARSET[
      Math.floor(Math.random() * CODE_COMMANDE_CHARSET.length)
    ];
  }
  return `TRR-${suffix}`;
}

async function seedOrderForConsumer(
  consumerId: string,
  producerId: string,
  overrides?: Partial<{ statut: string; montant_total: number }>,
): Promise<{ orderId: string; codeCommande: string }> {
  const codeCommande = randomCommandeCode();
  const { data, error } = await SUPABASE
    .from("orders")
    .insert({
      consumer_id: consumerId,
      producer_id: producerId,
      statut: overrides?.statut ?? "pending",
      code_commande: codeCommande,
      montant_total: overrides?.montant_total ?? 50,
      commission_terroir: 3,
      montant_net_producteur: 47,
      date_retrait: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedOrderForConsumer failed: ${error?.message}`);
  }
  return { orderId: data.id, codeCommande };
}

async function cleanupOrder(orderId: string): Promise<void> {
  await SUPABASE.from("orders").delete().eq("id", orderId);
}

describeIfLocal(
  "orders RLS UPDATE (F-001) — authenticated owner bloqué par policy USING=false WITH CHECK=false",
  () => {
    let consumerSession: AuthenticatedSession | null = null;
    let producer: ProducerRef | null = null;
    let orderId: string | null = null;

    beforeAll(() => {
      if (!reachable) {
        console.warn(
          "[F-001] Supabase locale non joignable, tests SQL skippés. " +
            "Lance `npx supabase start` pour exécuter la suite.",
        );
      }
    });

    afterEach(async () => {
      if (orderId) await cleanupOrder(orderId);
      if (consumerSession) {
        await cleanupAuthenticatedSession(SUPABASE, consumerSession);
      }
      if (producer) await cleanupProducerInline(producer);
      orderId = null;
      consumerSession = null;
      producer = null;
    });

    it("service_role : UPDATE statut → completed autorisé (path RPC SECDEF)", async () => {
      producer = await seedProducerInline({ statut: "public" });
      consumerSession = await seedAuthenticatedClient(SUPABASE, {
        emailPrefix: "f001-consumer",
      });
      const order = await seedOrderForConsumer(
        consumerSession.userId,
        producer.producerId,
      );
      orderId = order.orderId;

      // Service_role bypass RLS natif → simule le path RPC SECDEF.
      const { error } = await SUPABASE
        .from("orders")
        .update({ statut: "confirmed" })
        .eq("id", order.orderId);

      expect(error).toBeNull();

      const { data } = await SUPABASE
        .from("orders")
        .select("statut")
        .eq("id", order.orderId)
        .single();
      expect(data?.statut).toBe("confirmed");
    });

    it("authenticated consumer (owner) : UPDATE statut='completed' ⇒ 0 row affecté (bypass paiement bloqué)", async () => {
      producer = await seedProducerInline({ statut: "public" });
      consumerSession = await seedAuthenticatedClient(SUPABASE, {
        emailPrefix: "f001-attack-statut",
      });
      const order = await seedOrderForConsumer(
        consumerSession.userId,
        producer.producerId,
      );
      orderId = order.orderId;

      // Attaque exacte audit critique #1 : consumer auth tente passer
      // sa propre order à 'completed' via PATCH /orders direct.
      const { data, error } = await consumerSession.client
        .from("orders")
        .update({ statut: "completed" })
        .eq("id", order.orderId)
        .select();

      // PostgREST + RLS USING=false : pas d'erreur, mais data=[] (0 row).
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);

      // Verify côté service_role : la row n'a PAS bougé.
      const { data: rowAfter } = await SUPABASE
        .from("orders")
        .select("statut")
        .eq("id", order.orderId)
        .single();
      expect(rowAfter?.statut).toBe("pending");
    });

    it("authenticated consumer : UPDATE montant_total=1 ⇒ 0 row affecté (montant non forgeable)", async () => {
      producer = await seedProducerInline({ statut: "public" });
      consumerSession = await seedAuthenticatedClient(SUPABASE, {
        emailPrefix: "f001-attack-montant",
      });
      const order = await seedOrderForConsumer(
        consumerSession.userId,
        producer.producerId,
        { montant_total: 50 },
      );
      orderId = order.orderId;

      const { data, error } = await consumerSession.client
        .from("orders")
        .update({ montant_total: 1 })
        .eq("id", order.orderId)
        .select();

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);

      const { data: rowAfter } = await SUPABASE
        .from("orders")
        .select("montant_total")
        .eq("id", order.orderId)
        .single();
      expect(Number(rowAfter?.montant_total)).toBe(50);
    });

    it("authenticated consumer : UPDATE stripe_payment_intent_id forgé ⇒ 0 row affecté", async () => {
      producer = await seedProducerInline({ statut: "public" });
      consumerSession = await seedAuthenticatedClient(SUPABASE, {
        emailPrefix: "f001-attack-pi",
      });
      const order = await seedOrderForConsumer(
        consumerSession.userId,
        producer.producerId,
      );
      orderId = order.orderId;

      const { data, error } = await consumerSession.client
        .from("orders")
        .update({ stripe_payment_intent_id: "pi_attacker_forged" })
        .eq("id", order.orderId)
        .select();

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);

      const { data: rowAfter } = await SUPABASE
        .from("orders")
        .select("stripe_payment_intent_id")
        .eq("id", order.orderId)
        .single();
      expect(rowAfter?.stripe_payment_intent_id).toBeNull();
    });

    it("authenticated consumer : UPDATE notes_client ⇒ 0 row affecté (la policy bloque toutes colonnes)", async () => {
      // Note : l'audit reco initiale prévoyait que notes_client reste
      // mutable owner. La policy retenue est plus stricte (toutes colonnes
      // bloquées, transitions par RPC). Ce test verrouille cette décision.
      producer = await seedProducerInline({ statut: "public" });
      consumerSession = await seedAuthenticatedClient(SUPABASE, {
        emailPrefix: "f001-notes",
      });
      const order = await seedOrderForConsumer(
        consumerSession.userId,
        producer.producerId,
      );
      orderId = order.orderId;

      const { data, error } = await consumerSession.client
        .from("orders")
        .update({ notes_client: "Note ajoutée par owner" })
        .eq("id", order.orderId)
        .select();

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);

      const { data: rowAfter } = await SUPABASE
        .from("orders")
        .select("notes_client")
        .eq("id", order.orderId)
        .single();
      expect(rowAfter?.notes_client).toBeNull();
    });

    it("authenticated stranger (non-owner) : UPDATE order d'un autre user ⇒ 0 row affecté (RLS SELECT court-circuite)", async () => {
      producer = await seedProducerInline({ statut: "public" });
      const ownerSession = await seedAuthenticatedClient(SUPABASE, {
        emailPrefix: "f001-owner",
      });
      consumerSession = await seedAuthenticatedClient(SUPABASE, {
        emailPrefix: "f001-stranger",
      });

      const order = await seedOrderForConsumer(
        ownerSession.userId,
        producer.producerId,
      );
      orderId = order.orderId;

      try {
        const { data, error } = await consumerSession.client
          .from("orders")
          .update({ statut: "completed" })
          .eq("id", order.orderId)
          .select();

        expect(error).toBeNull();
        expect(data ?? []).toEqual([]);

        const { data: rowAfter } = await SUPABASE
          .from("orders")
          .select("statut")
          .eq("id", order.orderId)
          .single();
        expect(rowAfter?.statut).toBe("pending");
      } finally {
        await cleanupAuthenticatedSession(SUPABASE, ownerSession);
      }
    });
  },
);
