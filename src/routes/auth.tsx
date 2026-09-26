import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthSearch = { redirect?: string };

function safeRedirect(value: unknown): string {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value.startsWith("/auth")) return "/dashboard";
  if (value === "/") return "/dashboard";
  return value;
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AuthSearch =>
    typeof search['redirect'] === "string" ? { redirect: search['redirect'] } : {},

  head: () => ({
    meta: [
      { title: "Sign in — CARTEL HQ" },
      {
        name: "description",
        content: "Sign in to CARTEL HQ, the operating layer for the PEPECARTEL ecosystem.",
      },
      { property: "og:title", content: "Sign in — CARTEL HQ" },
      {
        property: "og:description",
        content: "Access the PEPECARTEL creative and campaign operating layer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

/**
 * PRIVATE BETA: sign-in only.
 *
 * Public self-registration is intentionally absent from this surface. There is
 * no client `supabase.auth.signUp` path, no "Create account" tab, no display
 * name signup field, and no signup confirmation-resend UX. Accounts are
 * provisioned out of band for approved CARTEL HQ operators.
 *
 * The auth callback route is deliberately untouched: invite and recovery links
 * still need it.
 */
function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const destination = safeRedirect(search.redirect);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) navigate({ to: destination, replace: true });
    });
    return () => {
      active = false;
    };
  }, [destination, navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      toast.success("Signed in");
      navigate({ to: destination, replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="rise-in w-full max-w-md min-w-0">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-md border border-gold/40 bg-surface-raised text-gold shadow-elevated">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <p className="type-eyebrow mt-4 text-muted-foreground">Private operating layer</p>
          <h1 className="mt-2 font-display text-3xl uppercase tracking-widest text-gold sm:text-4xl">
            CARTEL HQ
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The operating layer for PEPECARTEL creative tools, campaigns, creators, and
            distribution.
          </p>
        </div>

        <div className="cartel-panel relative overflow-hidden rounded-xl p-6 shadow-elevated">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gold/50"
            aria-hidden="true"
          />
          <div className="rounded-md border border-gold/35 bg-gold/5 px-3 py-2 text-xs leading-relaxed text-foreground">
            Private Beta. Access is limited to approved CARTEL HQ operators.
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="mt-2 min-h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete="current-password"
                className="mt-2 min-h-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error ? (
              <p role="alert" className="text-xs text-signal">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={busy} className="min-h-11 w-full">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground/80">
          Access is restricted to CARTEL HQ operators.
        </p>
      </div>
    </main>
  );
}
