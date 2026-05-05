'use client';

import dynamic from 'next/dynamic';

export const MiniMapLazy = dynamic(
  () => import('@/components/ui/mini-map').then((m) => m.MiniMap),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-green-100/50" />,
  },
);
