-- MINI-HQ B1 — PRODUCTION post-apply smoke (run ONLY after the owner applies
-- MINI_HQ_B1_custom_message_media.sql). Entirely inside a transaction that is
-- ROLLED BACK. No sends. Fill the :placeholders from read-only lookups first.
--   :ws_pro   workspace with active/trialing cartel_49 + saved brand kit
--   :ws_free  workspace on cartel_free (no official_broadcasts)
--   :ws_nokit workspace with no brand_kits row
--   :admin    owner/admin (operator) of :ws_pro and :ws_free
--   :outsider authenticated user with no role in :ws_pro
--   :owner    platform owner (berthonyxyz@gmail.com) user id
BEGIN;
-- fixture asset rows (rolled back; no storage object needed for selection)
INSERT INTO public.media_assets (id, workspace_id, uploaded_by, storage_path, asset_type, mime_type, width, height, file_size_bytes, metadata)
VALUES ('b1b1b1b1-0000-4000-8000-000000000001', :'ws_pro', :'admin', :'ws_pro' || '/custom-message-media/b1b1b1b1-0000-4000-8000-000000000001.png', 'other', 'image/png', 3, 2, 100, '{"purpose":"custom_message_media","animated":false}'),
       ('b1b1b1b1-0000-4000-8000-000000000002', :'ws_free', :'admin', :'ws_free' || '/custom-message-media/b1b1b1b1-0000-4000-8000-000000000002.png', 'other', 'image/png', 3, 2, 100, '{"purpose":"custom_message_media"}');
SELECT 'gate live Pro'   AS t, public.custom_media_gate_ok(public.evaluate_commercial_access(:'ws_pro', 'official_broadcasts', :'admin')) AS got, true AS want;
SELECT 'gate live Free'  AS t, public.custom_media_gate_ok(public.evaluate_commercial_access(:'ws_free', 'official_broadcasts', :'admin')) AS got, false AS want;
SELECT 'gate live owner' AS t, public.custom_media_gate_ok(public.evaluate_commercial_access(:'ws_free', 'official_broadcasts', :'owner')) AS got, true AS want;
SELECT 'admin Pro'   AS t, public.set_workspace_custom_message_media(:'ws_pro', :'admin', 'mission', 'b1b1b1b1-0000-4000-8000-000000000001')->>'ok' AS got, 'true' AS want;
SELECT 'owner bypass' AS t, public.set_workspace_custom_message_media(:'ws_free', :'owner', 'broadcast', 'b1b1b1b1-0000-4000-8000-000000000002')->>'ok' AS got, 'true (if ws_free has a brand kit, else BRAND_KIT_REQUIRED)' AS want;
SELECT 'free admin'  AS t, public.set_workspace_custom_message_media(:'ws_free', :'admin', 'mission', 'b1b1b1b1-0000-4000-8000-000000000002')->>'reason' AS got, 'PRO_REQUIRED' AS want;
SELECT 'foreign asset' AS t, public.set_workspace_custom_message_media(:'ws_pro', :'admin', 'mission', 'b1b1b1b1-0000-4000-8000-000000000002')->>'reason' AS got, 'ASSET_NOT_FOUND' AS want;
SELECT 'outsider'    AS t, public.set_workspace_custom_message_media(:'ws_pro', :'outsider', 'mission', NULL)->>'reason' AS got, 'FORBIDDEN' AS want;
SELECT 'no brand kit' AS t, public.set_workspace_custom_message_media(:'ws_nokit', :'owner', 'mission', NULL)->>'reason' AS got, 'BRAND_KIT_REQUIRED' AS want;
SELECT 'grants' AS t, has_function_privilege('authenticated', 'public.set_workspace_custom_message_media(uuid,uuid,text,uuid)', 'EXECUTE') AS got, false AS want;
ROLLBACK;
