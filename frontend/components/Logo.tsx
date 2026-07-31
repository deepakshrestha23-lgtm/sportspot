import Link from "next/link";

const logoImageSrc = "/images/sportspot-mark.png";
const logoImageIncludesText = false;

export default function Logo({
  className = "",
  href = "/",
  markClassName = "",
  showText,
  textClassName = "",
  variant = "dark",
}: {
  className?: string;
  href?: string;
  markClassName?: string;
  showText?: boolean;
  textClassName?: string;
  variant?: "dark" | "light";
}) {
  const textColor = variant === "light" ? "text-white" : "text-sportNavy";
  const shouldShowText = showText ?? !logoImageIncludesText;

  return (
    <Link className={`inline-flex shrink-0 items-center gap-3 ${className}`} href={href}>
      {logoImageSrc ? (
        <img alt="SportSpot" className={`h-11 w-auto object-contain ${markClassName}`} src={logoImageSrc} />
      ) : (
        <span
          className={`grid h-11 w-11 place-items-center rounded-xl bg-sportGreen text-sm font-black text-white shadow-lg shadow-green-950/20 ${markClassName}`}
        >
          SS
        </span>
      )}
      {shouldShowText ? <span className={`text-2xl font-black tracking-tight ${textColor} ${textClassName}`}>SportSpot</span> : null}
    </Link>
  );
}
