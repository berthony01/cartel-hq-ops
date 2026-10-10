# Cartel Command Center

Create a new full-stack Lovable project called CARTEL HQ for the PEPECARTEL ecosystem. This is Phase 0 only. Follow the workspace Controlled Surgical Build Protocol and stop after the foundation checkpoint.

PRODUCT ROLE
CARTEL HQ is the authenticated application layer for the PEPECARTEL ecosystem. The existing PEPECARTEL public marketing website is a separate project and must remain untouched. CARTEL HQ will eventually contain Sticker Lab, Brand Kit, Asset Vault, Operations, Missions, Operatives, Analytics, Reputation, Telegram tools, and additional AI creative utilities. Sticker Lab will be the first production module in later phases, but DO NOT build its backend or AI integration yet.

SYSTEM-OF-RECORD / SCOPE FOR THIS RUN
This is a brand-new CARTEL HQ application. For Phase 0, do NOT enable or create a database, auth backend, Supabase project, Lovable Cloud database, storage buckets, Stripe, Telegram bot, Telegram login, Kie.ai integration, OpenAI integration, external APIs, Edge Functions, webhooks, secrets, billing, or production deployment. Do not publish. No schema or migrations in this run.

DESIGN DIRECTION
Use the established PEPECARTEL visual identity while making the application UI more usable and less cinematic than the public marketing site.
Palette:
- deep black #070707
- charcoal #121212
- cartel gold #D4A82A
- dark gold #8E6B16
- signal red #D92027
- deep red #A80F18
- Pepe green #4BAE4F
- warm ivory #E9E0C9
Style: premium illustrated-cartel command-center aesthetic, crisp black/gold/red/green separation, restrained noir atmosphere, strong readability, polished SaaS dashboard UX, subtle borders/glows, no generic crypto-dashboard look.

PHASE 0 REQUIRED BUILD
1) Create the global CARTEL HQ application shell.
2) Desktop left sidebar + mobile drawer navigation.
3) Top app header with workspace selector placeholder, search placeholder, notifications placeholder, and user/avatar placeholder. These are visual only in this phase.
4) Navigation items:
   - HQ
   - Sticker Lab
   - Brand Kit
   - Assets
   - Operations
   - Missions
   - Operatives
   - Analytics
   - Settings
5) HQ dashboard page as the default route.
6) Sticker Lab, Brand Kit, Assets, Operations, Missions, Operatives, Analytics, and Settings routes must exist as lightweight placeholder pages only. They must clearly distinguish current vs future functionality without pretending features are live.
7) Sticker Lab should be visually marked as the first production module / coming next, but do not build generation, uploads, AI, Telegram, or database behavior yet.
8) HQ dashboard should include:
   - CARTEL HQ heading and short description
   - Workspace card placeholder labeled PEPECARTEL
   - Quick Actions area with disabled/placeholder actions: Create Sticker Pack, Manage Brand Kit, Connect Telegram
   - Recent Packs empty-state placeholder
   - AI Usage placeholder
   - Telegram Status placeholder
   - Upcoming modules / roadmap-style compact section showing Sticker Lab first, then Operations, Missions, Operatives, Analytics
9) Use reusable components, design tokens, layout primitives, empty states, buttons, badges, cards, and page headers.
10) Make desktop, tablet, and mobile layouts production-quality and responsive.
11) Add subtle restrained motion only: fade/rise, hover lift, border/glow transitions. No bouncing, spinning, excessive glitching, or flashing.
12) Include accessibility basics: keyboard-visible focus states, semantic headings, adequate contrast, tap-friendly controls.

COPY / POSITIONING
Use concise language that positions CARTEL HQ as the operational software layer of PEPECARTEL, not merely a sticker tool. Avoid claims that unfinished features are available.
Suggested dashboard subtitle: “The operating layer for PEPECARTEL creative tools, campaigns, creators, and distribution.”

PROHIBITED
- Do not touch or import the existing PEPECARTEL marketing website project.
- Do not create a backend or database.
- Do not add authentication logic.
- Do not add fake user data beyond clearly labeled visual placeholders.
- Do not add payments.
- Do not connect Telegram.
- Do not call or configure Kie.ai, OpenAI, Google, Ideogram, Recraft, or any external API.
- Do not create storage buckets.
- Do not add Operations/Missions business logic.
- Do not build motion sticker tools.
- Do not publish/deploy.
- Do not create unnecessary packages or infrastructure.

ACCEPTANCE CHECKPOINT
At the end of this run, report:
- files/routes/components created
- whether any backend/database/integration was created (must be NO)
- responsive behavior checked
- any known UI limitations
- exact stop point
Then STOP and wait for the next instruction.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://cartel-hq-ops.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/469fb83c-0f27-4aa7-bb99-c4125279c565).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
