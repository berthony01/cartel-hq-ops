/**
 * SE-16.1H — Telegram Mini App presentation primitives (read-only).
 *
 * Pure presentation. No server call, no credential handling, no mutation
 * control. Results and targets are always rendered as two separate, labelled
 * sections so a target can never be mistaken for an observed result.
 *
 * Padding prefers Telegram's own content-safe-area variables, falls back to
 * Telegram's safe-area variables, then to the browser `env()` insets, so the
 * frame stays clear of the Telegram header and controls on every edge.
 */

import type { ReactNode } from "react";
import {
  CircleEllipsis,
  Home,
  Inbox,
  Palette,
  RotateCw,
  Target,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Telegram content-safe area -> Telegram safe area -> browser env() -> minimum. */
function inset(edge: "top" | "right" | "bottom" | "left", minimum: string): string {
  return `max(var(--tg-content-safe-area-inset-${edge}, var(--tg-safe-area-inset-${edge}, env(safe-area-inset-${edge}, 0px))), ${minimum})`;
}

export function MiniAppFrame({
  children,
  navigation,
}: {
  children: ReactNode;
  navigation?: ReactNode;
}) {
  return (
    <div
      className="min-h-screen w-full bg-background text-foreground"
      style={{
        paddingTop: inset("top", "0.75rem"),
        paddingBottom: inset("bottom", navigation ? "5.5rem" : "1.25rem"),
        paddingLeft: inset("left", "0.875rem"),
        paddingRight: inset("right", "0.875rem"),
      }}
    >
      <div className="mx-auto flex w-full min-w-0 max-w-md flex-col gap-4">{children}</div>
      {navigation}
    </div>
  );
}

export function MiniAppIdentity({ subtitle = "Operator Console" }: { subtitle?: string | undefined }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border-subtle pb-3">
      <div className="min-w-0">
        <p className="type-eyebrow text-gold">Cartel HQ</p>
        <p className="mt-1 truncate font-display text-lg uppercase leading-none text-foreground">
          {subtitle}
        </p>
      </div>
      <span className="shrink-0 rounded-sm border border-gold/25 bg-gold/5 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-gold">
        Owner
      </span>
    </div>
  );
}

export type MiniAppTab = "home" | "missions" | "inbox" | "brand" | "more";

const MINI_APP_NAV_ITEMS: { key: MiniAppTab; label: string; icon: LucideIcon }[] = [
  { key: "home", label: "Home", icon: Home },
  { key: "missions", label: "Missions", icon: Target },
  { key: "inbox", label: "Inbox", icon: Inbox },
  { key: "brand", label: "Brand", icon: Palette },
  { key: "more", label: "More", icon: CircleEllipsis },
];

export function MiniAppTabBar({
  active,
  onSelect,
}: {
  active: MiniAppTab;
  onSelect: (tab: MiniAppTab) => void;
}) {
  return (
    <nav
      aria-label="Operator console"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/95 backdrop-blur-xl"
      style={{ paddingBottom: inset("bottom", "0.5rem") }}
    >
      <ul className="mx-auto grid w-full max-w-md grid-cols-5 gap-1 px-2 pt-1.5">
        {MINI_APP_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const selected = active === item.key;
          return (
            <li key={item.key} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelect(item.key)}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex min-h-12 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-md border border-transparent px-0.5 py-1 text-[9px] font-semibold uppercase transition-colors",
                  selected
                    ? "border-gold/20 bg-gold/8 text-gold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="w-full truncate text-center">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function MiniAppProjectIdentity({
  projectName,
  ticker,
  logoDataUrl,
}: {
  projectName: string;
  ticker: string | null;
  logoDataUrl: string | null;
}) {
  return (
    <section className="surface-command min-w-0 rounded-lg px-4 py-4">
      <div className="flex min-w-0 items-center gap-3">
        {logoDataUrl ? (
          <img
            src={logoDataUrl}
            alt=""
            className="size-12 shrink-0 rounded-md border border-gold/25 object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-md border border-gold/25 bg-gold/8 font-display text-xl text-gold"
          >
            {projectName.trim().slice(0, 1).toUpperCase() || "C"}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="type-eyebrow text-muted-foreground">Active project</p>
          <h1 className="mt-1 truncate font-display text-2xl uppercase leading-none text-foreground">
            {projectName}
          </h1>
          {ticker ? <p className="mt-1 truncate text-xs font-semibold text-gold">${ticker}</p> : null}
        </div>
      </div>
    </section>
  );
}

export function MiniAppPanel({
  heading,
  note,
  children,
  className,
}: {
  heading: string;
  note?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-lg border border-border/70 bg-surface-raised/40 px-3.5 py-3.5",
        className,
      )}
    >
      <p className="type-eyebrow text-gold">{heading}</p>
      {note ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{note}</p> : null}
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}

/** A labelled value line. `value` is already formatted null-honestly. */
export function MiniAppStatLine({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex min-h-9 min-w-0 items-center justify-between gap-3 border-b border-border/40 py-1.5 last:border-b-0">
      <span className="min-w-0 truncate text-[13px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          emphasis ? "text-gold" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Recovery affordance for a recoverable read failure. It only re-runs the same
 * validated read; it never carries a mutation or weakens authorization.
 */
export function MiniAppRetryButton({
  onRetry,
  pending,
  label = "Try again",
}: {
  onRetry: () => void;
  pending?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={pending}
      className="mt-1 inline-flex min-h-9 items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition-colors hover:bg-gold/15 disabled:opacity-60"
    >
      <RotateCw className={cn("size-3.5", pending ? "animate-spin" : null)} aria-hidden="true" />
      {pending ? "Retrying…" : label}
    </button>
  );
}

export function MiniAppMessage({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="surface-quiet flex min-w-0 flex-col items-center gap-2 rounded-lg border border-dashed border-border/70 px-4 py-8 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}

export function MiniAppSkeleton({ label }: { label: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-lg border border-border/60 bg-surface-raised/30">
      <p className="animate-pulse text-xs uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

/* ===================================================================== */
/* SE-16.2 UI — presentation-only editor primitives.                      */
/*                                                                        */
/* These render controls; they never call a server function, never hold a */
/* credential, and never decide authorization. All data and every         */
/* mutation handler are owned by the mission route.                       */
/* ===================================================================== */

export function MiniAppActionButton({
  label,
  onPress,
  pending,
  disabled,
  tone = "primary",
  pendingLabel,
}: {
  label: string;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
  tone?: "primary" | "quiet";
  pendingLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={pending || disabled}
      className={cn(
        "inline-flex min-h-11 w-full items-center justify-center rounded-md border px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] transition-colors disabled:opacity-60",
        tone === "primary"
          ? "border-gold/45 bg-gold/12 text-gold hover:bg-gold/20"
          : "border-border/70 bg-surface-raised/40 text-muted-foreground hover:text-foreground",
      )}
    >
      {pending ? (pendingLabel ?? "Saving…") : label}
    </button>
  );
}

/** Small selectable chip for a bounded choice. Presentation only. */
export function MiniAppChoiceChip({
  label,
  selected,
  onSelect,
  disabled,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "min-h-11 min-w-0 flex-1 rounded-md border px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-60",
        selected
          ? "border-gold/50 bg-gold/15 text-gold"
          : "border-border/60 bg-surface-raised/30 text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}

/** Labelled numeric field row. Blank is a meaningful value ("Off") upstream. */
export function MiniAppFieldRow({
  label,
  hint,
  value,
  onValueChange,
  placeholder,
  disabled,
}: {
  label: string;
  hint?: string | undefined;
  value: string;
  onValueChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 py-1.5">
      <span className="truncate text-[12px] text-muted-foreground">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded-md border border-border/70 bg-background px-3 py-2 text-sm tabular-nums text-foreground outline-none focus:border-gold/50 disabled:opacity-60"
      />
      {hint ? <span className="text-[11px] leading-4 text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** Inline notice. Copy is always pre-bounded by the caller. */
export function MiniAppNotice({
  tone,
  message,
  action,
}: {
  tone: "success" | "warning" | "error";
  message: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(
        "min-w-0 rounded-md border px-3 py-2.5 text-[12px] leading-5",
        tone === "success"
          ? "border-pepe/40 bg-pepe/8 text-pepe"
          : tone === "warning"
            ? "border-gold/40 bg-gold/8 text-gold"
            : "border-signal/40 bg-signal/8 text-signal",
      )}
    >
      <p className="min-w-0 break-words">{message}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Inline editor container. Opens in place; never navigates or uses prompts. */
export function MiniAppEditorShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-gold/30 bg-surface-raised/50 px-3.5 py-3.5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="type-eyebrow text-gold">{title}</p>
          {description ? (
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-9 shrink-0 rounded-md border border-border/60 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:text-foreground"
        >
          Close
        </button>
      </div>
      <div className="mt-3 min-w-0">{children}</div>
    </section>
  );
}
