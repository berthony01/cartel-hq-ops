import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Confirming access — CARTEL HQ" },
      {
        name: "description",
        content: "Completing secure sign-in for CARTEL HQ operators.",
      },
      { property: "og:title", content: "Confirming access — CARTEL HQ" },
      {
        property: "og:description",
        content: "Completing secure sign-in for CARTEL HQ operators.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const run = async () => {
      const url = new URL(window.location.href);
      const query = url.searchParams;
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""));

      const errDescription =
        query.get("error_description") ?? hash.get("error_description") ?? query.get("error") ?? hash.get("error");
      if (errDescription) {
        if (active) setError(errDescription);
        return;
      }

      try {
        const code = query.get("code");
        const tokenHash = query.get("token_hash");
        const type = query.get("type");
        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (tokenHash && type) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            type: type as "signup" | "email" | "recovery" | "invite" | "email_change" | "magiclink",
            token_hash: tokenHash,
          });
          if (otpError) throw otpError;
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) throw sessionError;
        } else {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw new Error("This confirmation link is missing or has already been used.");
        }

        if (!active) return;
        navigate({ to: "/dashboard", replace: true });
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not complete confirmation.");
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-md border border-gold/40 bg-surface-raised text-gold">
          <ShieldCheck className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 font-display text-2xl uppercase tracking-widest text-gold">CARTEL HQ</h1>

        {error ? (
          <>
            <p role="alert" className="mt-4 text-sm text-signal">
              {error}
            </p>
            <Button className="mt-6 min-h-11" onClick={() => navigate({ to: "/auth", replace: true })}>
              Back to sign in
            </Button>
          </>
        ) : (
          <p role="status" className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Confirming your access…
          </p>
        )}
      </div>
    </main>
  );
}
