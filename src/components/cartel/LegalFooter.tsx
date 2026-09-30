import { Link } from "@tanstack/react-router";

const LINKS = [
  { to: "/docs", label: "Documentation" },
  { to: "/docs", search: { article: "roadmap" }, label: "Roadmap" },
  { to: "/partner-program", label: "Partner Program" },
  { to: "/network", label: "Cartel Network" },
  { to: "/legal/terms", label: "Terms" },
  { to: "/legal/privacy", label: "Privacy" },
  { to: "/legal/refunds", label: "Refunds & Cancellation" },
  { to: "/legal/partner-agreement", label: "Partner Agreement" },
] as const;

export function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="CARTEL HQ information and legal" className={className}>
      <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        {LINKS.map((l) => (
          <li key={l.label}>
            <Link
              to={l.to}
              {...("search" in l ? { search: l.search } : {})}
              className="inline-flex min-h-11 items-center text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground underline-offset-4 hover:text-gold hover:underline focus-visible:text-gold"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
