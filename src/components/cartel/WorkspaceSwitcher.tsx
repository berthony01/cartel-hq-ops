import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createSelfServiceWorkspace } from "@/lib/self-service-workspace";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
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
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      // Owner membership + Free plan assignment are created by the existing
      // on_workspace_created trigger; the RPC only inserts the workspace.
      const id = await createSelfServiceWorkspace(trimmed);

      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
      await queryClient.refetchQueries({ queryKey: workspacesQueryKey });
      selectWorkspace(id);
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


/** Owner-only label change; public slugs, profiles and connected data stay untouched. */
function RenameWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { workspace } = useWorkspace();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(workspace?.name ?? "");
  }, [open, workspace?.id]);

  const normalized = name.trim().replace(/\s+/g, " ");
  const isOwner = !!workspace && workspace.access !== "managed" && workspace.owner_id === user?.id;
  const canSave = isOwner && !busy && normalized.length > 0 && normalized.length <= 80 && normalized !== (workspace?.name ?? "");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || !workspace || !user) return;
    setBusy(true);
    try {
      const { data, error } = await supabase
        .from("workspaces")
        .update({ name: normalized })
        .eq("id", workspace.id)
        .eq("owner_id", user.id)
        .select("id,name")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Only the project owner can rename this project.");
      await queryClient.invalidateQueries({ queryKey: workspacesQueryKey });
      await queryClient.refetchQueries({ queryKey: workspacesQueryKey });
      toast.success("Project display name updated. Review Project Profile to change public identity.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not rename the project.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename project</DialogTitle>
          <DialogDescription>
            Changes the name in Cartel HQ without creating a new project.
            Files, Telegram connections, launches and public URLs stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="rename-workspace-name">Project display name</Label>
            <Input
              id="rename-workspace-name"
              className="mt-2 min-h-11"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              required
              disabled={!isOwner || busy}
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Switching to a different token? Next update Project Profile name, ticker,
            public slug and links, then review your existing Telegram group and assets.
            Nothing is automatically removed or disconnected.
          </p>
          <DialogFooter>
            <Button type="submit" className="min-h-11" disabled={!canSave}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save project name
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkspaceSwitcher({ fullWidth = false }: { fullWidth?: boolean }) {
  const { workspaces, workspace, loading, selectWorkspace } = useWorkspace();
  const { user } = useSession();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const canRename = !!workspace && workspace.access !== "managed" && workspace.owner_id === user?.id;
  const ownWorkspaces = workspaces.filter((w) => w.access !== "managed");
  const managedWorkspaces = workspaces.filter((w) => w.access === "managed");

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
            {!loading && workspace?.access === "managed" ? (
              <span className="shrink-0 rounded-sm border border-gold/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold">
                Managed
              </span>
            ) : null}
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </Button>

        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 max-w-[calc(100vw-2rem)]">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Projects
          </DropdownMenuLabel>
          {ownWorkspaces.length === 0 ? (
            <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
          ) : (
            ownWorkspaces.map((w) => (
              <DropdownMenuItem key={w.id} onSelect={() => selectWorkspace(w.id)}>
                <span className="min-w-0 flex-1 truncate">{w.name}</span>
                {w.id === workspace?.id ? (
                  <Check className="size-4 text-gold" aria-hidden="true" />
                ) : null}
              </DropdownMenuItem>
            ))
          )}
          {managedWorkspaces.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Managed client projects
              </DropdownMenuLabel>
              {managedWorkspaces.map((w) => (
                <DropdownMenuItem key={w.id} onSelect={() => selectWorkspace(w.id)}>
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="shrink-0 rounded-sm border border-gold/30 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-gold">
                    Managed
                  </span>
                  {w.id === workspace?.id ? (
                    <Check className="size-4 text-gold" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          {canRename ? (
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              Rename current project
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add project
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <RenameWorkspaceDialog open={renameOpen} onOpenChange={setRenameOpen} />
    </>
  );
}
