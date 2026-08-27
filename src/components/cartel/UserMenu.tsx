import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { writeStoredWorkspaceId } from "@/lib/workspace-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(value: string): string {
  const parts = value.replace(/@.*/, "").split(/[.\-_\s]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? "");
  return (letters.join("") || value.slice(0, 2)).toUpperCase();
}

export function UserMenu() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const email = user?.email ?? "";
  const displayName =
    (user?.user_metadata?.['display_name'] as string | undefined)?.trim() || email;

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    writeStoredWorkspaceId(null);
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/auth", replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 transition-colors hover:border-gold/40"
        >
          <span className="flex size-7 items-center justify-center rounded-full border border-gold/40 bg-surface-raised text-[11px] font-semibold text-gold">
            {email ? initials(email) : "··"}
          </span>
          <span className="hidden max-w-32 truncate text-xs text-muted-foreground sm:inline">
            {displayName || "Account"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
          {email || "Signed in"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
