-- CARTEL HQ STAGING G2D: SESSION A (separate simultaneous database connection)
-- REVIEW ONLY; NOT APPROVED FOR EXECUTION. Project llicojkxpzwylghptmkf only.
-- Other project forbidden. No Kie.ai, AI calls, production, CI or Lovable.
-- Run A first, B during A's five-second held-lock window.
BEGIN;
SET LOCAL lock_timeout='12s';
SET LOCAL statement_timeout='25s';
SET LOCAL idle_in_transaction_session_timeout='30s';
SELECT 'A_START' AS event,pg_backend_pid() AS pid,clock_timestamp() AS t;
SELECT pg_catalog.pg_advisory_xact_lock(4127,2202);
SELECT 'A_LOCKED' AS event,pg_backend_pid() AS pid,clock_timestamp() AS t;
SELECT pg_sleep(5);
SELECT 'A_RESULT' AS event,pg_backend_pid() AS pid,clock_timestamp() AS t,
 public.cartel_guide_reserve_budget('8dceeade-c653-4861-ac82-b265b0cacf0c'::uuid,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
 md5('cartel-g2d-concurrency-race-A')::uuid) AS result;
COMMIT;
SELECT 'A_DONE' AS event,clock_timestamp() AS t;
