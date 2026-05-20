import { notFound } from "next/navigation";
import { WheatIcon } from "@/components/icons/wheat";

// Page démo temporaire (PR-B) pour valider visuellement l'épi de blé
// avant son intégration dans le hero home. Gating VERCEL_ENV (dev local
// + previews Vercel, masquée en prod). À supprimer avant merge PR-B.

export default function IconsPreviewPage() {
  if (process.env.VERCEL_ENV === "production") notFound();

  return (
    <div className="min-h-screen bg-bg p-6 md:p-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-12">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Dev preview · à supprimer après validation
          </span>
          <h1 className="mt-2 font-serif text-[40px] leading-tight text-green-900">
            Épi de blé — avatar producteur générique
          </h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-dark/70">
            Nouvelle icône <code className="rounded bg-dark/5 px-1.5 py-0.5">WheatIcon</code>{" "}
            destinée à remplacer la mention inventée « Ferme des Tilleuls »
            dans la carte tag du hero home. Direction « gravure au trait ».
          </p>
        </header>

        {/* Section 1 — l'icône seule, plusieurs tailles */}
        <section className="mb-16">
          <h2 className="mb-6 font-serif text-[24px] text-green-900">
            1. Icône seule (trait terra-800)
          </h2>
          <div className="flex flex-wrap items-end gap-8">
            {[
              { px: "h-44 w-44", label: "176px (examen détail)" },
              { px: "h-24 w-24", label: "96px" },
              { px: "h-11 w-11", label: "44px (taille réelle avatar)" },
            ].map((s) => (
              <div key={s.label} className="space-y-2 text-center">
                <div className="flex items-center justify-center rounded-2xl bg-white p-4 shadow-soft">
                  <WheatIcon className={`${s.px} text-terra-800`} />
                </div>
                <p className="font-mono text-[12px] text-dark/60">{s.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Section 2 — rendu réel dans la carte tag du hero, 2 variantes
            d'avatar à arbitrer */}
        <section>
          <h2 className="mb-2 font-serif text-[24px] text-green-900">
            2. Rendu réel — carte tag hero (sur fond visuel simulé)
          </h2>
          <p className="mb-6 text-[13px] text-dark/60">
            La carte blanche telle qu&apos;elle apparaît en bas du visuel
            hero. Deux variantes d&apos;avatar à arbitrer.
          </p>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Variante A — avatar terra */}
            <div className="space-y-3">
              <div
                className="relative overflow-hidden rounded-2xl p-6"
                style={{ aspectRatio: "16 / 9", background: "linear-gradient(135deg, #a3b18a, #588157)" }}
              >
                <div className="absolute inset-x-6 bottom-6 flex items-center gap-3.5 rounded-xl bg-white/92 p-3.5 backdrop-blur">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-terra-100">
                    <WheatIcon className="h-7 w-7 text-terra-800" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-tight text-terroir-ink">
                      Producteurs sélectionnés · Sarthe
                    </div>
                    <div className="mt-0.5 text-xs leading-tight text-terroir-muted">
                      Circuit court · de la ferme à ta table
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-center font-mono text-[12px] text-dark/60">
                Variante A — avatar terra-100 / épi terra-800
              </p>
            </div>

            {/* Variante B — avatar vert */}
            <div className="space-y-3">
              <div
                className="relative overflow-hidden rounded-2xl p-6"
                style={{ aspectRatio: "16 / 9", background: "linear-gradient(135deg, #a3b18a, #588157)" }}
              >
                <div className="absolute inset-x-6 bottom-6 flex items-center gap-3.5 rounded-xl bg-white/92 p-3.5 backdrop-blur">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100">
                    <WheatIcon className="h-7 w-7 text-green-900" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-tight text-terroir-ink">
                      Producteurs sélectionnés · Sarthe
                    </div>
                    <div className="mt-0.5 text-xs leading-tight text-terroir-muted">
                      Circuit court · de la ferme à ta table
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-center font-mono text-[12px] text-dark/60">
                Variante B — avatar green-100 / épi green-900
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
