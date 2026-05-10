import { ExportDataButton } from "./_components/ExportDataButton";

// F-011 (audit pré-launch 2026-05-10) — Page de portabilité RGPD art. 20.
// Le user clique sur le bouton, la server action prépare un zip avec ses
// données personnelles, le client télécharge. 5 exports/24h max.
//
// L'auth est garantie par le layout `/compte/*` (server component qui
// redirect /connexion si pas de session). Pas besoin de re-checker ici.
//
// La page reste server component (pas de "use client") — seul le bouton
// est client. Cohérent avec le pattern des autres pages /compte/*.

export const metadata = {
  title: "Exporter mes données — TerrOir",
};

export default function ExporterMesDonneesPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-terroir-ink">
          Exporter mes données
        </h1>
        <p className="text-terroir-muted">
          Télécharge une copie complète de tes données personnelles dans un
          fichier zip&nbsp;: profil, commandes, articles commandés, avis,
          notifications récentes et candidatures producteur (le cas échéant).
        </p>
      </header>

      <section className="rounded-lg border border-terroir-border bg-white p-5">
        <h2 className="text-lg font-medium text-terroir-ink">
          Que contient le téléchargement&nbsp;?
        </h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-terroir-ink">
          <li>
            <code>export.json</code> : la version structurée complète
            (machine-readable, conforme RGPD art. 20).
          </li>
          <li>
            <code>profil.csv</code> : tes informations de compte.
          </li>
          <li>
            <code>commandes.csv</code> et <code>articles_commandes.csv</code>{" "}
            : ton historique d&rsquo;achats.
          </li>
          <li>
            <code>avis.csv</code> : les avis que tu as postés sur des
            producteurs.
          </li>
          <li>
            <code>notifications.csv</code> : les notifications reçues sur 90
            jours.
          </li>
          <li>
            <code>interets_producteurs.csv</code> : si tu as déposé une
            candidature producteur.
          </li>
          <li>
            <code>README.txt</code> : explication courte de chaque fichier.
          </li>
        </ul>
        <p className="mt-3 text-xs text-terroir-muted">
          Les journaux de sécurité (audit logs) ne sont pas inclus&nbsp;: ils
          sont conservés 1 an pour la sécurité du service (RGPD art. 32) et ne
          contiennent pas de données fournies par toi.
        </p>
      </section>

      <section className="rounded-lg border border-terroir-border bg-white p-5">
        <h2 className="text-lg font-medium text-terroir-ink">Télécharger</h2>
        <p className="mt-2 text-sm text-terroir-muted">
          Limite&nbsp;: 5 téléchargements par 24h pour éviter les abus.
        </p>
        <div className="mt-4">
          <ExportDataButton />
        </div>
      </section>
    </div>
  );
}
