import { useEffect, useState } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type AuthSearch = { redirect?: string };

function safeRedirect(value: unknown): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.startsWith("/auth")) return "/";
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

function AuthPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/auth" });
  const destination = safeRedirect(search.redirect);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
    setNotice(null);

    try {
      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
        toast.success("Signed in");
        navigate({ to: destination, replace: true });
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,

          ...(displayName.trim() ? { data: { display_name: displayName.trim() } } : {}),
        },
      });
      if (signUpError) throw signUpError;

      if (data.session) {
        toast.success("Account created");
        navigate({ to: destination, replace: true });
      } else {
        setNotice(
          "Account created. Check your inbox and click the confirmation link to finish signing in.",
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    const address = email.trim();
    if (!address) {
      setError("Enter your email address first.");
      return;
    }

    setResendBusy(true);
    setError(null);
    setNotice(null);

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: address,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (resendError) throw resendError;
      setNotice("Confirmation email resent. Check your inbox and click the link to finish signing in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend confirmation email.");
    } finally {
      setResendBusy(false);
    }
  };

  const showResend =
    (notice && notice.toLowerCase().includes("confirmation")) ||
    (error && error.toLowerCase().includes("email not confirmed"));

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex size-11 items-center justify-center rounded-md border border-gold/40 bg-surface-raised text-gold">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          <h1 className="mt-4 font-display text-3xl uppercase tracking-widest text-gold">
            CARTEL HQ
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The operating layer for PEPECARTEL creative tools, campaigns, creators, and
            distribution.
          </p>
        </div>

        <div className="cartel-panel rounded-xl p-6">
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as "signin" | "signup");
              setError(null);
              setNotice(null);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <TabsContent value="signup" className="m-0 space-y-4">
                <div>
                  <Label htmlFor="display-name">Display name (optional)</Label>
                  <Input
                    id="display-name"
                    className="mt-2 min-h-11"
                    autoComplete="nickname"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              </TabsContent>

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
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
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

              {notice ? (
                <p
                  role="status"
                  className="rounded-md border border-gold/35 bg-gold/5 px-3 py-2 text-xs text-foreground"
                >
                  {notice}
                </p>
              ) : null}

              {showResend ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || resendBusy}
                  onClick={handleResend}
                  className="min-h-11 w-full"
                >
                  {resendBusy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  Resend confirmation email
                </Button>
              ) : null}

              <Button type="submit" disabled={busy} className="min-h-11 w-full">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>
            </form>
          </Tabs>
        </div>

        <p className="mt-4 text-center text-[11px] text-muted-foreground/80">
          Access is restricted to CARTEL HQ operators.
        </p>
      </div>
    </main>
  );
}
