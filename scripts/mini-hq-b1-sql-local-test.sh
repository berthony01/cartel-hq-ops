#!/usr/bin/env bash
# MINI-HQ B1 — executes the STAGED SQL against a THROWAWAY local Postgres with
# schema-faithful stubs (media_assets, brand_kits, authority + commercial RPCs).
# Never touches production. Usage: bash scripts/mini-hq-b1-sql-local-test.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="$(mktemp -d)"; PORT=55439
trap 'pg_ctl -D "$D/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$D"' EXIT
initdb -D "$D/data" -U postgres -A trust >/dev/null
pg_ctl -D "$D/data" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" start -w >/dev/null
Q() { psql -h "$D" -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

Q <<'SQL'
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.media_assets(id uuid primary key, workspace_id uuid not null, asset_type text, mime_type text,
  file_size_bytes bigint, storage_path text, width int, height int, metadata jsonb);
CREATE TABLE public.brand_kits(workspace_id uuid primary key, metadata jsonb, updated_at timestamptz);
CREATE TABLE public.t_ops(ws uuid, u uuid); CREATE TABLE public.t_owner(u uuid); CREATE TABLE public.t_gate(ws uuid, g jsonb);
CREATE FUNCTION public.has_platform_unrestricted_access(u uuid) RETURNS boolean LANGUAGE sql AS
  $$ SELECT CASE WHEN u = '00000000-0000-4000-8000-00000000000e' THEN NULL ELSE EXISTS(SELECT 1 FROM public.t_owner WHERE t_owner.u = $1) END $$;
CREATE FUNCTION public.is_workspace_operator(w uuid, u uuid) RETURNS boolean LANGUAGE sql AS
  $$ SELECT CASE WHEN u = '00000000-0000-4000-8000-00000000000e' THEN NULL ELSE EXISTS(SELECT 1 FROM public.t_ops WHERE ws = w AND t_ops.u = $2) END $$;
CREATE FUNCTION public.evaluate_commercial_access(w uuid, f text, u uuid) RETURNS jsonb LANGUAGE sql AS
  $$ SELECT CASE WHEN EXISTS(SELECT 1 FROM public.t_owner WHERE t_owner.u = $3)
     THEN '{"allowed":true,"reason":"UNRESTRICTED","mode":"unrestricted","would_block":false}'::jsonb
     ELSE (SELECT g FROM public.t_gate WHERE ws = w) END $$;
SQL
Q -f "$ROOT/docs/sql/MINI_HQ_B1_custom_message_media.sql"

PASS=0; FAIL=0
t() { local name="$1" want="$2" got; got="$(Q -c "$3" | tail -n1)"; if [[ "$got" == "$want" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL $name: want [$want] got [$got]"; fi; }

PRO='{"allowed":true,"reason":"FEATURE_INCLUDED","would_block":false,"feature_key":"official_broadcasts","plan_code":"cartel_49","kind":"feature","enabled":true,"assignment_status":"active","mode":"enforce","enforcement_mode":"enforce"}'
WS=11111111-1111-4111-8111-111111111111; WF=22222222-2222-4222-8222-222222222222; WN=33333333-3333-4333-8333-333333333333
ADM=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; OWN=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb; OUT=cccccccc-cccc-4ccc-8ccc-cccccccccccc; NUL=00000000-0000-4000-8000-00000000000e
A1=a1a1a1a1-0000-4000-8000-000000000001; A2=a1a1a1a1-0000-4000-8000-000000000002; AF=a1a1a1a1-0000-4000-8000-00000000000f
AB=a1a1a1a1-0000-4000-8000-0000000000b0; AX=a1a1a1a1-0000-4000-8000-0000000000b1; AD=a1a1a1a1-0000-4000-8000-0000000000b2; AP=a1a1a1a1-0000-4000-8000-0000000000b3
Q <<SQL
INSERT INTO t_owner VALUES ('$OWN'); INSERT INTO t_ops VALUES ('$WS','$ADM'),('$WN','$ADM'),('$WF','$ADM');
INSERT INTO t_gate VALUES ('$WS','$PRO'::jsonb),('$WN','$PRO'::jsonb);
INSERT INTO brand_kits VALUES ('$WS','{"tone":"noir","palette":["#070707"]}',now()),('$WF','{}',now());
INSERT INTO media_assets VALUES
 ('$A1','$WS','other','image/png',1000,'$WS/custom-message-media/$A1.png',3,2,'{"purpose":"custom_message_media","animated":false}'),
 ('$A2','$WS','other','image/gif',900,'$WS/custom-message-media/$A2.gif',4,4,'{"purpose":"custom_message_media","animated":true}'),
 ('$AF','$WF','other','image/png',1000,'$WF/custom-message-media/$AF.png',3,2,'{"purpose":"custom_message_media"}'),
 ('$AB','$WS','other','image/png',1000,'$WS/custom-message-media/$AB.jpg',3,2,'{"purpose":"custom_message_media"}'),
 ('$AX','$WS','other','image/png',1000,'$WS/custom-message-media/$AX.png',NULL,2,'{"purpose":"custom_message_media"}'),
 ('$AD','$WS','other','image/png',NULL,'$WS/custom-message-media/$AD.png',3,2,'{"purpose":"custom_message_media"}'),
 ('$AP','$WS','logo','image/png',1000,'$WS/custom-message-media/$AP.png',3,2,'{"purpose":"custom_message_media"}');
SQL
S() { echo "SELECT public.set_workspace_custom_message_media('$1','$2','$3',$4)->>'${5:-reason}'"; }

# gate predicate (positive-only)
G() { echo "SELECT public.custom_media_gate_ok('$1'::jsonb)"; }
t "gate Pro active" t "$(G "$PRO")"
t "gate Pro trialing" t "$(G "$(echo "$PRO" | sed 's/"active"/"trialing"/')")"
t "gate allowed+plan only" f "$(G '{"allowed":true,"plan_code":"cartel_49"}')"
t "gate would_block missing" f "$(G "$(echo "$PRO" | sed 's/"would_block":false,//')")"
t "gate would_block true" f "$(G "$(echo "$PRO" | sed 's/"would_block":false/"would_block":true/')")"
t "gate would_block string" f "$(G "$(echo "$PRO" | sed 's/"would_block":false/"would_block":"false"/')")"
t "gate inactive" f "$(G "$(echo "$PRO" | sed 's/"active"/"canceled"/')")"
t "gate wrong feature" f "$(G "$(echo "$PRO" | sed 's/official_broadcasts/x_missions/')")"
t "gate enabled null" f "$(G "$(echo "$PRO" | sed 's/"enabled":true/"enabled":null/')")"
t "gate mode mismatch" f "$(G "$(echo "$PRO" | sed 's/"enforcement_mode":"enforce"/"enforcement_mode":"observe"/')")"
t "gate bad mode" f "$(G "$(echo "$PRO" | sed 's/"mode":"enforce","enforcement_mode":"enforce"/"mode":"x","enforcement_mode":"x"/')")"
t "gate free plan" f "$(G "$(echo "$PRO" | sed 's/cartel_49/cartel_free/')")"
t "gate wrong reason" f "$(G "$(echo "$PRO" | sed 's/FEATURE_INCLUDED/WITHIN_LIMIT/')")"
t "gate UNRESTRICTED" t "$(G '{"allowed":true,"reason":"UNRESTRICTED","mode":"unrestricted"}')"
t "gate UNRESTRICTED not allowed" f "$(G '{"allowed":false,"reason":"UNRESTRICTED","mode":"unrestricted"}')"
t "gate allowed string" f "$(G "$(echo "$PRO" | sed 's/"allowed":true/"allowed":"true"/')")"
t "gate null" f "SELECT public.custom_media_gate_ok(NULL)"
t "gate array" f "$(G '[]')"

# authority + isolation
t "admin Pro select ok" true "$(S $WS $ADM mission "'$A1'" ok)"
t "owner select (bypass) ok" true "$(S $WS $OWN broadcast "'$A2'" ok)"
t "outsider forbidden" FORBIDDEN "$(S $WS $OUT mission "'$A1'")"
t "NULL authority forbidden" FORBIDDEN "$(S $WS $NUL mission "'$A1'")"
t "outsider clear forbidden" FORBIDDEN "$(S $WS $OUT mission NULL)"
t "foreign workspace asset" ASSET_NOT_FOUND "$(S $WS $ADM mission "'$AF'")"
t "free workspace denied" PRO_REQUIRED "$(S $WF $ADM mission "'$AF'")"
t "no gate row (NULL) denied" PRO_REQUIRED "$(S 44444444-4444-4444-8444-444444444444 $ADM mission "'$A1'")"
t "extension mismatch" ASSET_NOT_FOUND "$(S $WS $ADM mission "'$AB'")"
t "NULL width" ASSET_NOT_FOUND "$(S $WS $ADM mission "'$AX'")"
t "NULL size" ASSET_NOT_FOUND "$(S $WS $ADM mission "'$AD'")"
t "wrong asset_type" ASSET_NOT_FOUND "$(S $WS $ADM mission "'$AP'")"
t "bad slot" INVALID_INPUT "$(S $WS $ADM avatar "'$A1'")"
t "no brand kit" BRAND_KIT_REQUIRED "$(S $WN $ADM mission NULL)"
t "other metadata preserved" 'noir|t' "SELECT metadata->>'tone' || '|' || (metadata ? 'palette')::text FROM brand_kits WHERE workspace_id='$WS'"
t "gif animated flag stored" true "SELECT metadata->'custom_message_media'->'broadcast'->>'animated' FROM brand_kits WHERE workspace_id='$WS'"
t "clear mission ok" true "$(S $WS $ADM mission NULL ok)"
t "clear keeps broadcast" "f|$A2" "SELECT (metadata->'custom_message_media' ? 'mission')::text || '|' || (metadata->'custom_message_media'->'broadcast'->>'asset_id') FROM brand_kits WHERE workspace_id='$WS'"
# grants
t "anon cannot execute" f "SELECT has_function_privilege('anon','public.set_workspace_custom_message_media(uuid,uuid,text,uuid)','EXECUTE')"
t "authenticated cannot execute" f "SELECT has_function_privilege('authenticated','public.set_workspace_custom_message_media(uuid,uuid,text,uuid)','EXECUTE')"
t "service_role can execute" t "SELECT has_function_privilege('service_role','public.set_workspace_custom_message_media(uuid,uuid,text,uuid)','EXECUTE')"
t "gate helper not public" f "SELECT has_function_privilege('authenticated','public.custom_media_gate_ok(jsonb)','EXECUTE')"
t "search_path empty" 't|t' "SELECT bool_and(proconfig::text LIKE '%search_path=\"\"%')::text || '|' || bool_or(prosecdef)::text FROM pg_proc WHERE proname IN ('set_workspace_custom_message_media','custom_media_gate_ok')"

echo "B1 SQL local: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
