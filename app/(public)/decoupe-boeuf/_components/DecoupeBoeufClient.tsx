'use client';

import { useState } from 'react';
import { CowSchemaInteractive } from '@/components/beef/CowSchemaInteractive';
import { MorceauPanel } from '@/components/beef/MorceauPanel';
import type { BeefCutSlug } from '@/lib/beef-cuts';

export type DecoupeBoeufClientProps = {
  /** Markup SVG V2 charge cote serveur (data-cat injecte). */
  svgMarkup: string;
};

/**
 * Wrapper client : tient l'etat selectedId partage entre
 * CowSchemaInteractive (clic sur zone) et MorceauPanel (panneau lateral).
 */
export function DecoupeBoeufClient({ svgMarkup }: DecoupeBoeufClientProps) {
  const [selectedId, setSelectedId] = useState<BeefCutSlug | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
      <div className="lg:col-span-8">
        <div className="bg-white rounded-3xl border border-terroir-border p-6 h-full shadow-soft">
          <Legend />
          <CowSchemaInteractive
            svgMarkup={svgMarkup}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>

      <div className="lg:col-span-4">
        <div className="bg-white rounded-3xl border border-terroir-border p-7 h-full shadow-soft min-h-[580px]">
          <MorceauPanel
            selectedId={selectedId}
            onClear={() => setSelectedId(null)}
          />
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const items: ReadonlyArray<{
    cssVar: string;
    label: string;
  }> = [
    { cssVar: 'var(--cat-nobles)', label: 'Nobles' },
    { cssVar: 'var(--cat-boucher)', label: 'Pieces du boucher' },
    { cssVar: 'var(--cat-polyvalent)', label: 'Polyvalents' },
    { cssVar: 'var(--cat-mijoter)', label: 'A mijoter' },
    { cssVar: 'var(--cat-tradition)', label: 'Tradition' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4 text-[12px] text-terroir-ink/75">
      <span className="font-semibold text-terroir-ink/55 uppercase tracking-wider text-[10px]">
        Familles
      </span>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="w-3 h-3 rounded-sm"
            style={{ background: item.cssVar }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
