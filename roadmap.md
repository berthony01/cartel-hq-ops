# Roadmap

## C8.7 Cartel Verified Launch

- [x] C8.7A — read-only eligibility evaluator + deployment evidence panel
- [x] C8.7B — owner-only, evidence-bound official contract registration
- [ ] C8.7C — decouple OFFICIAL_CONTRACT_REGISTERED watcher notification from the
      lifecycle transition; add one explicit owner-triggered, idempotent
      "notify watchers" action in Launch Control reusing `launch_events`,
      `launch_notification_deliveries` and the existing `launch-notifications` worker.
- [ ] C8.7D — Telegram / official group broadcast integration (not authorized)
- [ ] C8.7E — correction workflow, audit ledger, terminology hardening (not authorized)
