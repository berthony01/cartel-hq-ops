import type { ReactNode } from "react";

export function LaunchControlHero({
  identity,
  facts,
  action,
  lifecycle,
}: {
  identity: ReactNode;
  facts: ReactNode;
  action: ReactNode;
  lifecycle: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden border border-gold/40 bg-surface shadow-[var(--shadow-cartel),var(--glow-gold)]">
      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.72fr)]">
        <div className="min-w-0 px-4 py-5 sm:px-6 sm:py-6">
          {identity}
          <div className="mt-5">{facts}</div>
        </div>
        <div className="min-w-0 border-t border-gold/25 bg-surface-raised/55 p-4 sm:p-6 lg:border-l lg:border-t-0">
          {action}
        </div>
      </div>
      <div className="min-w-0 px-4 pb-5 sm:px-6 sm:pb-6">{lifecycle}</div>
    </section>
  );
}