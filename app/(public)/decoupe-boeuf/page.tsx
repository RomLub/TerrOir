import type { Metadata } from 'next';
import { SpeciesTabs } from '@/components/beef/SpeciesTabs';
import { loadCowSvgV2 } from '@/lib/beef/load-cow-svg';
import { DecoupeBoeufClient } from './_components/DecoupeBoeufClient';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Les morceaux du boeuf | TerrOir',
  description:
    "Schema interactif des morceaux du boeuf en boucherie francaise. Cliquez sur une zone pour decouvrir le morceau, ses cuissons recommandees et ses portions.",
};

export default async function DecoupeBoeufPage() {
  const svgMarkup = await loadCowSvgV2();

  return (
    <div className="bg-bg">
      <main className="max-w-[1400px] mx-auto px-6 md:px-8 pt-10 pb-16">
        <header className="mb-7 max-w-[720px]">
          <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-terra-700 mb-3">
            Notre demarche · Connaitre la viande
          </div>
          <h1 className="font-serif text-[44px] md:text-[56px] leading-[1.02] font-medium tracking-tight">
            Les morceaux du{' '}
            <em className="text-terra-700 italic">boeuf</em>
          </h1>
          <p className="mt-4 text-[16px] md:text-[17px] leading-[1.55] text-terroir-ink/70">
            La decoupe francaise compte une trentaine de morceaux. Choisir le
            bon, c&apos;est respecter l&apos;animal — et mieux cuisiner. Cliquez
            sur le schema pour decouvrir chaque piece, son usage et ses
            cuissons.
          </p>
        </header>

        <SpeciesTabs />

        <DecoupeBoeufClient svgMarkup={svgMarkup} />

        <footer className="mt-6 text-[11px] text-terroir-ink/45">
          Schema anatomique adapte de{' '}
          <a
            href="https://commons.wikimedia.org/wiki/File:Beef_cuts_France.svg"
            target="_blank"
            rel="noreferrer noopener"
            className="underline hover:text-terroir-ink/70"
          >
            Beef cuts France
          </a>{' '}
          sur Wikimedia Commons (CC-BY-SA 3.0), base sur la charte de decoupe
          francaise (UECBV).
        </footer>
      </main>
    </div>
  );
}
