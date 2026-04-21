"use client";

const LABELS = ["Compte", "Vous", "Exploitation"];

export function Progress({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
        <span>
          Étape {current}/{total}
        </span>
        <span className="text-terroir-green-700">{LABELS[current - 1]}</span>
      </div>
      <div className="mt-2 flex gap-1.5">
        {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
          <div
            key={step}
            className={`h-1 flex-1 rounded-full transition-colors ${
              step <= current ? "bg-terroir-green-700" : "bg-gray-200"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
