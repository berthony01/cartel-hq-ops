<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep Telegram delivery state machines transport-owned; presentation helpers may only transform a payload immediately before the existing single send/edit call, never add fallback sends.
- Keep Mission Setup Auto-select provider reads in the external Supabase function where the existing X credential lives; the app bridge may only forward signed initData and return bounded suggestions.
- PCART auction/liquidity plan (P8A) lives only in `src/lib/pcart-auction-liquidity-plan.ts` (declarative manifest + pure wei math + inert intents) with reviews in immutable owner-only `pcart_auction_liquidity_plan_reviews`; why: one pinned source for addresses/hashes and no execution capability until a separately authorized P8B+.
