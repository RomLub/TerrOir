import Image from "next/image";
import Link from "next/link";

export type LogoProps = {
  href?: string;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "light";
  withTagline?: boolean;
  className?: string;
};

const sizePx: Record<NonNullable<LogoProps["size"]>, number> = {
  sm: 32,
  md: 48,
  lg: 96,
};

export function Logo({
  href = "/",
  size = "md",
  variant = "default",
  withTagline = false,
  className = "",
}: LogoProps) {
  const px = sizePx[size];
  const taglineColor =
    variant === "light" ? "text-white/70" : "text-terroir-muted";
  const content = (
    <span className={`inline-flex flex-col items-start leading-none ${className}`}>
      <Image
        src="/Logo_TerrOir_transparent.png"
        alt="TerrOir"
        width={px}
        height={px}
        priority
      />
      {withTagline ? (
        <span className={`mt-1 text-xs ${taglineColor}`}>
          La marketplace des produits du terroir
        </span>
      ) : null}
    </span>
  );

  if (!href) return content;
  return (
    <Link href={href} aria-label="TerrOir — accueil" className="inline-block">
      {content}
    </Link>
  );
}
