# Roadmap

## Stage 1 — Public Entry (in progress)
- [ ] Move `_authenticated/index.tsx` → `_authenticated/dashboard.tsx` (route id + title)
- [ ] Create public `src/routes/index.tsx` landing page
- [ ] auth.tsx + auth_.callback.tsx defaults → /dashboard
- [ ] nav.ts, SidebarNav, AppShell → /dashboard
- [ ] Verification suite + source checks; report; no publish

## Blocked / later
- Phase 3A Project Profile recomposition — blocked on start gate (HEAD must be 200c75a…)
- Domain migration externals: Supabase Edge secrets, BotFather, Auth redirect URLs, Reown allow-list, Lovable domain activation
- telegram-webhook redeploy for new Mini App URL (authorized code patch only so far)
