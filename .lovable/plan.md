# Phase 1E Start-Gate Audit — Platform Owner + Admin Console Foundation

Read-only inspection at HEAD `d479936`, clean tree. No files changed.

## 1. Current architecture

- **Auth/session**: `src/routes/_authenticated/route.tsx` (`ssr: false`, `beforeLoad` uses `supabase.auth.getSession()` with a 2s timeout, redirects to `/auth`). `src/hooks/useSession.ts` is a global external-store mirror; single `onAuthStateChange` listener lives in `src/routes/__root.tsx`.
- **Layout**: `AppShell` (sidebar + top bar + `MobileTabBar`), wrapped by `WorkspaceProvider`.
- **Workspace scope**: `src/lib/workspace-context.tsx` — reads `workspaces` directly via the browser client (RLS-scoped), persists active workspace in localStorage. No role is fetched client-side.
- **Nav**: `src/lib/nav.ts` — static section/item array with `status: "planned"` presentation and `mobilePrimary` metadata. No role/entitlement filtering exists.
- **Data patterns**: two shapes in use — (a) direct RLS-scoped table reads via the browser Supabase client (`sticker-packs.ts`, `telegram-group.ts`, `media.ts`); (b) authenticated Edge Function RPC with a tolerant frontend contract type (`sticker-drops.ts` → `sticker-drop-config`, actions + `canManage`/`role` returned by the server). Pattern (b) is the correct precedent for anything privileged.
- **Settings** (`/settings`) is still a `PlaceholderPage` and already lists "Billing and usage limits" as planned — the natural host for a platform/plan surface.

## 2. Is there a platform-level role/entitlement mechanism today?

No. What exists is **workspace-scoped only**:

- `workspaces.owner_id`, `workspace_members.role` (free-text `string`, not an enum), DB functions `is_workspace_owner`, `is_workspace_member`, `can_access_pack`.
- `sticker-drop-config` returns `role: "owner" | "admin" | "member"` and `canManage` — but that is per-workspace authority, not platform authority.
- `usage_ledger` (units, provider/internal cost) exists as metering data, with no quota, plan, or entitlement table anywhere.
- There is no `user_roles` table, no `app_role` enum (`Enums` is empty), no `platform_admins`, no plan/subscription table, and no client-side notion of a superuser.

Conclusion: a platform owner concept must be introduced server-side; nothing today can be reused as-is.

## 3. Recommended minimal frontend surface for an owner console

Frontend only; all authority comes from the server response.

- `src/lib/platform.ts` — thin authenticated client mirroring `sticker-drops.ts`: one `supabase.functions.invoke("platform-admin", { action: "status" })` call returning `{ isPlatformOwner, capabilities, metrics }`, plus shared error parsing. No email checks, no table reads.
- `src/hooks/usePlatformAccess.ts` — `useQuery` wrapper exposing `{ isPlatformOwner, loading }`, cached per session, fail-closed on error.
- `src/routes/_authenticated/admin.tsx` — Owner Console route. Renders a plain "not available" state (not a redirect, not a 404 leak) when the server says the caller is not the platform owner.
- `src/lib/nav.ts` — add an `ownerOnly?: boolean` presentation flag on the Admin item; `SidebarNav`/`MobileTabBar` hide it when `isPlatformOwner` is false. Hiding is cosmetic only; the route and the Edge Function enforce.
- Reuse existing primitives (`PageHeader`, `Section`, `InlineRow`, `StatusBadge`, `EmptyState`) — no new visual architecture.

Backend (separately authorized, not in this phase): a `platform_admins` / `user_roles` table keyed on `auth.users.id` with a `SECURITY DEFINER` `is_platform_owner(_user_id)` check, seeded once by user id for the confirmed account, plus a `platform-admin` Edge Function that reads the caller's JWT `sub` and never trusts request-supplied identity.

## 4. Email-based bypass vs user-id/role

- **Email in client code**: worthless as a control — bundle-visible, trivially edited in devtools, and any data it unlocks must already be RLS-open, i.e. open to everyone. Reject outright.
- **Email compared server-side**: still weak. Emails are mutable, can be changed via Auth, and unverified sign-ups can claim a domain/address; a compare that ignores `email_confirmed_at` is a direct privilege-escalation path.
- **Correct**: authority is a row keyed on the immutable `auth.users.id`, seeded once out-of-band, checked by a `SECURITY DEFINER` function under RLS and re-checked inside every privileged Edge Function from the verified JWT subject. The UI only ever *renders* what the server already decided.

## 5. Recommended Phase 1E boundary (no Stripe, no paid plans)

In scope:
1. Server-side platform-owner identity + `is_platform_owner` check, seeded by user id (authorized migration, separate contract).
2. `platform-admin` Edge Function with a read-only `status` action.
3. Frontend: `platform.ts`, `usePlatformAccess.ts`, `/admin` route, owner-only nav flag.
4. Owner Console v1 shows read-only platform metrics already derivable from existing tables (workspaces, packs, published packs, connected groups, drop events, usage_ledger totals).

Explicitly out of scope: Stripe, plan/price/subscription tables, entitlement enforcement, quota blocking, feature flags, per-workspace plan assignment, impersonation, member management writes, and any change to Sticker Lab generation, transparency/export, Telegram link/publish/distribution, drop scheduling, auth, or routing for existing surfaces.

Suggested split: **1E-A** backend owner identity + status function; **1E-B** frontend console and nav gating. Pricing/entitlements begin at Phase 1F on top of the same `is_platform_owner` primitive.
