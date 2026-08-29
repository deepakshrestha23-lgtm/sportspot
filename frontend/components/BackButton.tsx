import Link from "next/link";

export default function BackButton({ href, label = "Back" }: { href: string; label?: string }) {
  return (
    <Link className="sport-back-link" href={href}>
      <ArrowLeftIcon />
      <span>{label}</span>
    </Link>
  );
}

function ArrowLeftIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M19 12H5m7 7-7-7 7-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
