import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalizeReferralCode, storeReferralCode } from "@/lib/partners";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AuthMode = "signin" | "signup";
type AuthSearch = { redirect?: string; mode?: AuthMode; ref?: string };

function safeRedirect(value: unknown): string {
  if (typeof value !== "string") return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value.startsWith("/auth")) return "/dashboard";
  if (value === "/") return "/dashboard";
  return value;
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AuthSearch => {
    const out: AuthSearch = {};
    if (typeof search['redirect'] === "string") out.redirect = search['redirect'];
    if (search['mode'] === "signup") out.mode = "signup";
    // Optional partner referral code: only a normalized ^[a-z0-9]{10}$ value is kept.
    const ref = normalizeReferralCode(search['ref']);
    if (ref) out.ref = ref;
    return out;
  },

  head: () => ({
    meta: [
      { title: "Sign in or start free — CARTEL HQ" },
      {
        name: "description",
        content: "Sign in to CARTEL HQ or create a free account — no credit card required.",
      },
      { property: "og:title", content: "Sign in or start free — CARTEL HQ" },
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
 * Sign in, or self-service Free account creation (?mode=signup).
 * Email/password only, no credit card. With email confirmation enabled,
 * signUp returns no session: we show a "check your email" state and never
 * treat the user as signed in. The auth callback route is unchanged.
 */
function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const destination = safeRedirect(search.redirect);

  const mode: AuthMode = search.mode === "signup" ? "signup" : "signin";
  const isSignup = mode === "signup";
  const [confirmSentTo, setConfirmSentTo] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store a valid referral code locally (code + timestamp only; no partner id).
  useEffect(() => {
    if (search.ref) storeReferralCode(search.ref);
  }, [search.ref]);

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
      if (isSignup) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          toast.success("Account created");
          navigate({ to: destination, replace: true });
        } else {
          setConfirmSentTo(email.trim());
          setPassword("");
        }
        return;
      }
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
          <p className="type-eyebrow mt-4 text-muted-foreground">{isSignup ? "Start free" : "Sign in"}</p>
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
            {isSignup
              ? "Free includes 1 project and 1 Telegram community. No credit card required."
              : "Sign in to your CARTEL HQ account."}
          </div>

          {confirmSentTo ? (
            <div role="status" className="mt-6 space-y-2 text-sm leading-relaxed text-foreground">
              <p className="font-semibold text-gold">Check your email</p>
              <p className="text-muted-foreground">
                We sent a confirmation link to {confirmSentTo}. You are not signed in yet — open
                the link to confirm your account, then sign in.
              </p>
            </div>
          ) : (
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
                autoComplete={isSignup ? "new-password" : "current-password"}
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
              {isSignup ? "Create free account" : "Sign in"}
            </Button>
          </form>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          {isSignup ? "Already have an account? " : "New to CARTEL HQ? "}
          <button
            type="button"
            className="min-h-11 font-semibold text-gold underline-offset-4 hover:underline"
            onClick={() => {
              setError(null);
              setConfirmSentTo(null);
              navigate({
                to: "/auth",
                search: { ...(search.redirect ? { redirect: search.redirect } : {}), ...(search.ref ? { ref: search.ref } : {}), ...(isSignup ? {} : { mode: "signup" as const }) },
                replace: true,
              });
            }}
          >
            {isSignup ? "Sign in" : "Start free"}
          </button>
        </p>
      </div>
    </main>
  );
}
