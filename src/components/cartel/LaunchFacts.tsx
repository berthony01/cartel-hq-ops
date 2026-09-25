import type { ReactNode } from "react";

export type LaunchFact = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
};

export function LaunchFacts({ facts }: { facts: LaunchFact[] }) {
  return (
    <dl className="divide-y divide-border-subtle border-y border-border-subtle sm:grid sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0 py-3 sm:px-4 sm:first:pl-0 sm:last:pr-0">
          <dt className="type-eyebrow text-muted-foreground">{fact.label}</dt>
          <dd className="mt-1.5 min-w-0 text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
            {fact.value}
          </dd>
          {fact.detail ? (
            <dd className="mt-1 min-w-0 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {fact.detail}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}