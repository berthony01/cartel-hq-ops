import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace, workspacesQueryKey } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { selectWorkspace } = useWorkspace();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) throw userError ?? new Error("Not signed in.");

      // Owner membership row is created by the existing on_workspace_created trigger.
      const { data, error } = await supabase
        .from("workspaces")
        .insert({ name: trimmed, slug: slugify(trimmed) || null, owner_id: userData.user.id })
        .select("id")
        .single();
      if (error) throw error;

      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
      await queryClient.refetchQueries({ queryKey: workspacesQueryKey });
      if (data?.id) selectWorkspace(data.id);
      toast.success(`Project “${trimmed}” added`);
      setName("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>
            Each project keeps its own Project Profile, Brand Kit, assets, sticker packs, launches
            and connected Telegram communities separated. You become the owner.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="workspace-name">Project name</Label>
            <Input
              id="workspace-name"
              className="mt-2 min-h-11"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="PEPECARTEL"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !name.trim()} className="min-h-11">
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Add project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceSwitcher({ fullWidth = false }: { fullWidth?: boolean }) {
  const { workspaces, workspace, loading, selectWorkspace } = useWorkspace();
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label="Project selector"
            className={cn(
              "flex w-full min-w-0 min-h-11 justify-start gap-2 border-border-subtle bg-surface-quiet px-3 text-sm text-muted-foreground shadow-none hover:border-gold/30 hover:bg-surface-raised lg:min-h-10",
              fullWidth ? "lg:w-full" : "lg:w-auto",
            )}
          >
            <Building2 className="size-4 shrink-0 text-gold" aria-hidden="true" />
            <span className={cn("min-w-0 flex-1 truncate text-left font-medium text-foreground", !fullWidth && "lg:max-w-40 lg:flex-none")}>
              {loading ? "Loading…" : (workspace?.name ?? "No project")}
            </span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </Button>

        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Projects
          </DropdownMenuLabel>
          {workspaces.length === 0 ? (
            <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
          ) : (
            workspaces.map((w) => (
              <DropdownMenuItem key={w.id} onSelect={() => selectWorkspace(w.id)}>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === workspace?.id ? (
                  <Check className="size-4 text-gold" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
