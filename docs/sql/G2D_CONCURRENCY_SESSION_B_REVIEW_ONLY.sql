-- CARTEL HQ STAGING G2D: SESSION B (separate simultaneous database connection)
-- REVIEW ONLY; NOT APPROVED FOR EXECUTION. Project llicojkxpzwylghptmkf only.
-- Other project forbidden. No Kie.ai, AI calls, production, CI or Lovable.
-- Run A first, B during A's five-second held-lock window.
BEGIN;
SET LOCAL lock_timeout='12s';
SET LOCAL statement_timeout='25s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SELECT 'B_START' AS event,pg_backend_pid() AS pid,clock_timestamp() AS t;
SELECT 'B_RESULT' AS event,pg_backend_pid() AS pid,clock_timestamp() AS t,
 public.cartel_guide_reserve_budget('9da5e296-dc49-43ce-82d5-200cbd0130c7'::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
 md5('cartel-g2d-concurrency-race-B')::uuid) AS result;
COMMIT;
SELECT 'B_DONE' AS event,clock_timestamp() AS t;
