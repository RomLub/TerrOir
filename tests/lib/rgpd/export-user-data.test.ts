import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  buildExportPayload,
  buildExportZip,
  buildExportFilename,
  type ExportPayload,
} from "@/lib/rgpd/export-user-data";

// =============================================================================
// Mock Supabase admin client (queue par-table — pattern doctrine LOT 2 pickup).
// =============================================================================

type Row = Record<string, unknown>;
type TableQueueResponse = { data: Row | Row[] | null; error: null | { message: string } };

function makeAdminClient(queues: Record<string, TableQueueResponse[]>) {
  return {
    from(table: string) {
      const queue = queues[table] ?? [];
      const builder = {
        _select: undefined as string | undefined,
        _filters: [] as Array<{ op: string; col: string; val: unknown }>,
        select(cols: string) {
          this._select = cols;
          return this;
        },
        eq(col: string, val: unknown) {
          this._filters.push({ op: "eq", col, val });
          return this;
        },
        ilike(col: string, val: unknown) {
          this._filters.push({ op: "ilike", col, val });
          return this;
        },
        gte(col: string, val: unknown) {
          this._filters.push({ op: "gte", col, val });
          return this;
        },
        order(_col: string, _opts?: unknown) {
          return this;
        },
        maybeSingle() {
          const next = queue.shift();
          return Promise.resolve(next ?? { data: null, error: null });
        },
        // Le builder résout via .then() pour "queries non-single" (orders, etc.)
        then(resolve: (val: TableQueueResponse) => unknown) {
          const next = queue.shift();
          return Promise.resolve(next ?? { data: [], error: null }).then(
            resolve,
          );
        },
      };
      return builder;
    },
  };
}

const FIXED_NOW = new Date("2026-05-10T12:00:00.000Z");

describe("buildExportPayload", () => {
  it("aggrège profil + orders + items + reviews + notifications + interests", async () => {
    const admin = makeAdminClient({
      users: [
        {
          data: {
            email: "user@example.com",
            prenom: "Alice",
            nom: "Martin",
            telephone: "0612345678",
            sms_optin: true,
            cgu_version: "v1.0",
            cgu_accepted_at: "2026-04-01T10:00:00Z",
            created_at: "2026-04-01T10:00:00Z",
          },
          error: null,
        },
      ],
      orders: [
        {
          data: [
            {
              id: "order-1",
              code_commande: "TRR-AAAA1",
              statut: "completed",
              date_retrait: "2026-04-15",
              heure_retrait: "10:00",
              montant_total: 42.5,
              commission_terroir: 2.55,
              notes_client: "Sans sac plastique",
              created_at: "2026-04-10T08:00:00Z",
              confirmed_at: "2026-04-10T09:00:00Z",
              completed_at: "2026-04-15T10:30:00Z",
              cancelled_at: null,
              order_items: [
                {
                  order_id: "order-1",
                  quantite: 2,
                  prix_unitaire: 8,
                  sous_total: 16,
                  products: { nom: "Salade mesclun" },
                },
                {
                  order_id: "order-1",
                  quantite: 1,
                  prix_unitaire: 26.5,
                  sous_total: 26.5,
                  products: { nom: "Côte de bœuf" },
                },
              ],
              producers: {
                nom_exploitation: "Ferme du Test",
                commune: "Le Mans",
              },
            },
          ],
          error: null,
        },
      ],
      reviews: [
        {
          data: [
            {
              id: "review-1",
              note: 5,
              commentaire: "Excellent",
              statut: "published",
              created_at: "2026-04-16T08:00:00Z",
              published_at: "2026-04-16T09:00:00Z",
              orders: { code_commande: "TRR-AAAA1" },
              producers: { nom_exploitation: "Ferme du Test" },
            },
          ],
          error: null,
        },
      ],
      notifications: [
        {
          data: [
            {
              id: "notif-1",
              type: "email",
              template: "order_confirmed",
              statut: "sent",
              created_at: "2026-04-15T09:00:00Z",
            },
          ],
          error: null,
        },
      ],
      producer_interests: [
        {
          data: [
            {
              id: "interest-1",
              source: "formulaire_public",
              statut: "new",
              prenom: "Alice",
              nom: "Martin",
              nom_exploitation: "Projet ferme",
              commune: "Le Mans",
              telephone: "0612345678",
              message: "Intéressée",
              created_at: "2026-03-01T08:00:00Z",
            },
          ],
          error: null,
        },
      ],
    });

    const payload = await buildExportPayload(
      admin as unknown as Parameters<typeof buildExportPayload>[0],
      "user-42",
      FIXED_NOW,
    );

    expect(payload.meta.user_id).toBe("user-42");
    expect(payload.meta.format_version).toBe("1.0");
    expect(payload.meta.notifications_window_days).toBe(90);
    expect(payload.profil?.email).toBe("user@example.com");
    expect(payload.commandes).toHaveLength(1);
    expect(payload.commandes[0]).toMatchObject({
      code_commande: "TRR-AAAA1",
      producer_nom_exploitation: "Ferme du Test",
      producer_commune: "Le Mans",
    });
    expect(payload.articles_commandes).toHaveLength(2);
    expect(payload.articles_commandes[0]).toMatchObject({
      order_code: "TRR-AAAA1",
      product_nom: "Salade mesclun",
      quantite: 2,
    });
    expect(payload.avis).toHaveLength(1);
    expect(payload.avis[0]).toMatchObject({
      order_code: "TRR-AAAA1",
      producer_nom_exploitation: "Ferme du Test",
    });
    expect(payload.notifications).toHaveLength(1);
    expect(payload.interets_producteurs).toHaveLength(1);
  });

  it("retourne arrays vides + profil null si user inexistant", async () => {
    const admin = makeAdminClient({
      users: [{ data: null, error: null }],
      orders: [{ data: [], error: null }],
      reviews: [{ data: [], error: null }],
      notifications: [{ data: [], error: null }],
    });
    const payload = await buildExportPayload(
      admin as unknown as Parameters<typeof buildExportPayload>[0],
      "ghost-user",
      FIXED_NOW,
    );
    expect(payload.profil).toBeNull();
    expect(payload.commandes).toEqual([]);
    expect(payload.articles_commandes).toEqual([]);
    expect(payload.avis).toEqual([]);
    expect(payload.notifications).toEqual([]);
    expect(payload.interets_producteurs).toEqual([]);
  });

  it("ne lookup PAS producer_interests si profile email null", async () => {
    const tablesQueried: string[] = [];
    const admin = {
      from(table: string) {
        tablesQueried.push(table);
        const builder = {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          ilike() {
            return this;
          },
          gte() {
            return this;
          },
          order() {
            return this;
          },
          maybeSingle() {
            if (table === "users") {
              return Promise.resolve({
                data: {
                  email: null,
                  prenom: null,
                  nom: null,
                  telephone: null,
                  sms_optin: null,
                  cgu_version: null,
                  cgu_accepted_at: null,
                  created_at: null,
                },
                error: null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve: (val: unknown) => unknown) {
            return Promise.resolve({ data: [], error: null }).then(resolve);
          },
        };
        return builder;
      },
    };
    await buildExportPayload(
      admin as unknown as Parameters<typeof buildExportPayload>[0],
      "user-no-email",
      FIXED_NOW,
    );
    expect(tablesQueried).not.toContain("producer_interests");
  });
});

describe("buildExportZip", () => {
  function makePayload(): ExportPayload {
    return {
      meta: {
        user_id: "user-42",
        generated_at: FIXED_NOW.toISOString(),
        notifications_window_days: 90,
        format_version: "1.0",
      },
      profil: {
        email: "user@example.com",
        prenom: "Alice",
        nom: "Martin",
        telephone: "0612345678",
        sms_optin: true,
        cgu_version: "v1.0",
        cgu_accepted_at: "2026-04-01T10:00:00Z",
        created_at: "2026-04-01T10:00:00Z",
      },
      commandes: [
        {
          id: "order-1",
          code_commande: "TRR-AAAA1",
          statut: "completed",
          date_retrait: "2026-04-15",
          heure_retrait: "10:00",
          montant_total: 42.5,
          commission_terroir: 2.55,
          notes_client: "Note avec, virgule",
          created_at: "2026-04-10T08:00:00Z",
          confirmed_at: "2026-04-10T09:00:00Z",
          completed_at: "2026-04-15T10:30:00Z",
          cancelled_at: null,
          producer_nom_exploitation: "Ferme du Test",
          producer_commune: "Le Mans",
        },
      ],
      articles_commandes: [
        {
          order_code: "TRR-AAAA1",
          product_nom: "Salade mesclun",
          quantite: 2,
          prix_unitaire: 8,
          sous_total: 16,
        },
      ],
      avis: [],
      notifications: [],
      interets_producteurs: [],
    };
  }

  it("construit un zip valide contenant les fichiers attendus", async () => {
    const payload = makePayload();
    const zipBytes = await buildExportZip(payload);
    const zip = await JSZip.loadAsync(zipBytes);

    const files = Object.keys(zip.files).sort();
    expect(files).toEqual([
      "README.txt",
      "articles_commandes.csv",
      "avis.csv",
      "commandes.csv",
      "export.json",
      "notifications.csv",
      "profil.csv",
    ]);
  });

  it("inclut interets_producteurs.csv UNIQUEMENT si non vide", async () => {
    const payload = makePayload();
    payload.interets_producteurs = [
      {
        id: "interest-1",
        source: "formulaire_public",
        statut: "new",
        prenom: "Alice",
        nom: "Martin",
        nom_exploitation: "Projet ferme",
        commune: "Le Mans",
        telephone: "0612345678",
        message: "Test",
        created_at: "2026-03-01T08:00:00Z",
      },
    ];
    const zipBytes = await buildExportZip(payload);
    const zip = await JSZip.loadAsync(zipBytes);
    expect(zip.files["interets_producteurs.csv"]).toBeDefined();
  });

  it("export.json est valide JSON et reflète le payload", async () => {
    const payload = makePayload();
    const zipBytes = await buildExportZip(payload);
    const zip = await JSZip.loadAsync(zipBytes);
    const content = await zip.files["export.json"].async("string");
    const parsed = JSON.parse(content);
    expect(parsed.meta.user_id).toBe("user-42");
    expect(parsed.commandes).toHaveLength(1);
  });

  it("CSV commandes échappe les virgules dans les notes_client (RFC 4180)", async () => {
    const payload = makePayload();
    const zipBytes = await buildExportZip(payload);
    const zip = await JSZip.loadAsync(zipBytes);
    const csv = await zip.files["commandes.csv"].async("string");
    expect(csv).toContain('"Note avec, virgule"');
  });

  it("README.txt mentionne les fichiers du zip", async () => {
    const payload = makePayload();
    const zipBytes = await buildExportZip(payload);
    const zip = await JSZip.loadAsync(zipBytes);
    const readme = await zip.files["README.txt"].async("string");
    expect(readme).toContain("export.json");
    expect(readme).toContain("commandes.csv");
    expect(readme).toContain("avis.csv");
  });
});

describe("buildExportFilename", () => {
  it("formate avec userId + YYYY-MM-DD", () => {
    expect(buildExportFilename("user-42", FIXED_NOW)).toBe(
      "terroir-export-user-42-2026-05-10.zip",
    );
  });
});
