import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Handshake, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useWorkspace } from "@/lib/workspace-context";
import {
  ACTIVE_PARTNER_SCOPES,
  PARTNER_CLIENT_SCOPES,
  PARTNER_DENIED_AREAS,
  PARTNER_SCOPE_LABELS,
  fetchMyPartnerInvites,
  fetchOwnerPartnerAccess,
  respondToInvite,
  invitePartner,
  partnerClientErrorMessage,
  partnerClientKeys,
  revokePartner,
  updatePartnerScopes,
  type OwnerPartnerAccess,
  type PartnerClientScope,
} from "@/lib/partner-client-access";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function ScopePicker({ value, onChange, idPrefix }: { value: PartnerClientScope[]; onChange: (v: PartnerClientScope[]) => void; idPrefix: string }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {PARTNER_CLIENT_SCOPES.map((scope) => {
        const active = ACTIVE_PARTNER_SCOPES.includes(scope);
        const id = `${idPrefix}-${scope}`;
        return (
          <label key={scope} htmlFor={id} className="flex min-h-11 items-center gap-2 rounded-md border border-border-subtle px-3 py-2 text-sm">
            <input
              id={id}
              type="checkbox"
              className="size-4 accent-[var(--gold)]"
              checked={value.includes(scope)}
              onChange={(e) => onChange(e.target.checked ? [...value, scope] : value.filter((s) => s !== scope))}
            />
            <span className="min-w-0 flex-1">{PARTNER_SCOPE_LABELS[scope]}</span>
            {!active ? <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Coming soon</span> : null}
          </label>
        );
      })}
    </div>
  );
}

function AccessRow({ row, workspaceId }: { row: OwnerPartnerAccess; workspaceId: string }) {
  const qc = useQueryClient();
  const [scopes, setScopes] = useState<PartnerClientScope[]>(row.scopes);
  const [confirm, setConfirm] = useState(false);
  const open = row.status === "pending" || row.status === "active";
  const refresh = () => qc.invalidateQueries({ queryKey: partnerClientKeys.ownerList(workspaceId) });
  const save = useMutation({
    mutationFn: () => updatePartnerScopes(row.access_id, scopes),
    onSuccess: () => { toast.success("Permissions updated"); refresh(); },
    onError: (e) => toast.error(partnerClientErrorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: () => revokePartner(row.access_id),
    onSuccess: () => { toast.success("Access revoked"); setConfirm(false); refresh(); },
    onError: (e) => toast.error(partnerClientErrorMessage(e)),
  });
  const changed = [...scopes].sort().join() !== [...row.scopes].sort().join();

  return (
    <div className="rounded-md border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{row.partner_reference}</span>
        <StatusBadge tone={row.status === "active" ? "green" : row.status === "pending" ? "gold" : "muted"}>{row.status}</StatusBadge>
        <span className="text-xs text-muted-foreground">Invited {new Date(row.invited_at).toLocaleDateString()}</span>
      </div>
      {open ? (
        <div className="mt-3 space-y-3">
          <ScopePicker value={scopes} onChange={setScopes} idPrefix={row.access_id} />
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" disabled={!changed || save.isPending} onClick={() => save.mutate()}>Save permissions</Button>
            <Button variant="outline" className="min-h-11 border-destructive/40 text-destructive" onClick={() => setConfirm(true)}>Revoke access</Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          {PARTNER_CLIENT_SCOPES.filter((s) => row.scopes.includes(s)).map((s) => PARTNER_SCOPE_LABELS[s]).join(", ") || "No permissions"}
        </p>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke Service Partner access?</AlertDialogTitle>
            <AlertDialogDescription>
              Access ends immediately. Your project data, settings, history, subscription and communities stay exactly as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={(e) => { e.preventDefault(); revoke.mutate(); }} disabled={revoke.isPending}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Owner-only panel. Server RPCs re-check ownership on every call. */
export function ServicePartnerAccessPanel() {
  const { user } = useSession();
  const { workspace, workspaceId, isManaged } = useWorkspace();
  const qc = useQueryClient();
  const isOwner = !!user && !!workspace && !isManaged && workspace.owner_id === user.id;
  const [email, setEmail] = useState("");
  const [scopes, setScopes] = useState<PartnerClientScope[]>(["project_identity"]);

  const list = useQuery({
    queryKey: partnerClientKeys.ownerList(workspaceId),
    queryFn: () => fetchOwnerPartnerAccess(workspaceId!),
    enabled: isOwner && !!workspaceId,
  });
  const invite = useMutation({
    mutationFn: () => invitePartner(workspaceId!, email, scopes),
    onSuccess: () => {
      toast.success("Invitation sent. The Service Partner must accept it.");
      setEmail("");
      qc.invalidateQueries({ queryKey: partnerClientKeys.ownerList(workspaceId) });
    },
    onError: (e) => toast.error(partnerClientErrorMessage(e)),
  });

  if (!isOwner) return null;

  return (
    <Section
      title="Service Partner access"
      leading={<Handshake className="size-4" aria-hidden="true" />}
      description="Let an approved Service Partner help manage this project. They must accept first, only get the permissions you choose, and you can revoke access at any time. You stay the owner."
    >
      {list.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />Loading…</div>
      ) : list.data === null || list.isError ? (
        <p className="text-sm text-muted-foreground">Service Partner access is not available yet.</p>
      ) : (
        <div className="space-y-5">
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); if (email.trim() && !invite.isPending) invite.mutate(); }}
          >
            <div>
              <Label htmlFor="sp-invite-email">Service Partner sign-in email</Label>
              <Input id="sp-invite-email" type="email" autoComplete="off" className="mt-2 min-h-11" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <ScopePicker value={scopes} onChange={setScopes} idPrefix="sp-invite" />
            <Button type="submit" className="min-h-11" disabled={!email.trim() || invite.isPending}>
              {invite.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Send invitation
            </Button>
          </form>

          <div className="space-y-3">
            {(list.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No Service Partner has access to this project.</p>
            ) : (
              (list.data ?? []).map((row) => <AccessRow key={`${row.access_id}-${row.status}-${row.scopes.join()}`} row={row} workspaceId={workspaceId!} />)
            )}
          </div>

          <div>
            <p className="type-eyebrow text-muted-foreground">Never available to Service Partners</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {PARTNER_DENIED_AREAS.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Partner dashboard: pending invitations (accept/decline) + active managed projects. */
export function ManagedProjectsSection() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const { workspaces, selectWorkspace } = useWorkspace();
  const managed = workspaces.filter((w) => w.access === "managed");
  const invites = useQuery({
    queryKey: partnerClientKeys.invites(userId),
    queryFn: fetchMyPartnerInvites,
    enabled: !!userId,
  });
  const respond = useMutation({
    mutationFn: (v: { id: string; accept: boolean }) => respondToInvite(v.id, v.accept),
    onSuccess: (_d, v) => {
      toast.success(v.accept ? "Invitation accepted" : "Invitation declined");
      qc.invalidateQueries({ queryKey: partnerClientKeys.all });
    },
    onError: (e) => toast.error(partnerClientErrorMessage(e)),
  });
  const scopeText = (s: PartnerClientScope[]) =>
    PARTNER_CLIENT_SCOPES.filter((x) => s.includes(x))
      .map((x) => PARTNER_SCOPE_LABELS[x] + (ACTIVE_PARTNER_SCOPES.includes(x) ? "" : " (coming soon)"))
      .join(", ") || "No permissions";

  return (
    <>
      <Section title="Pending invitations" description="Project owners who want your help. Nothing is shared until you accept.">
        {(invites.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending invitations.</p>
        ) : (
          <div className="space-y-3">
            {(invites.data ?? []).map((inv) => (
              <div key={inv.access_id} className="rounded-md border border-border-subtle p-3">
                <p className="font-medium text-foreground [overflow-wrap:anywhere]">{inv.workspace_name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{scopeText(inv.scopes)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button className="min-h-11" disabled={respond.isPending} onClick={() => respond.mutate({ id: inv.access_id, accept: true })}>Accept</Button>
                  <Button variant="outline" className="min-h-11" disabled={respond.isPending} onClick={() => respond.mutate({ id: inv.access_id, accept: false })}>Decline</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title="Managed projects" description="Client projects you can help with. Each one stays owned by the client, who can change or revoke your access at any time.">
        {managed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No managed projects yet.</p>
        ) : (
          <div className="space-y-3">
            {managed.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground [overflow-wrap:anywhere]">{w.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{scopeText(w.scopes ?? [])}</p>
                </div>
                <Button variant="outline" className="min-h-11" onClick={() => selectWorkspace(w.id)}>Switch to project</Button>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
