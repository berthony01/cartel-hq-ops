import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { createSelfServiceWorkspace } from "@/lib/self-service-workspace";
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

export function WorkspaceSwitcher({ fullWidth = false }: { fullWidth?: boolean }) {
  const { workspaces, workspace, loading, selectWorkspace } = useWorkspace();
  const [dialogOpen, setDialogOpen] = useState(false);
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
