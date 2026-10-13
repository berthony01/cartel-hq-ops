-- STAGING ONLY: authorization-simulation RLS tests. NO permanent changes.
-- These mock request.jwt.claim.sub, NOT real Supabase Auth sessions or signed URL requests.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
DO $verify_alpha$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM s2_fixture.sticker_assets;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'S2 FAIL: Alpha asset visibility'; END IF;
  IF NOT s2_fixture.member_can_access_private_sticker_path(
    's2-fixture-private','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generated_sticker/33333333-3333-4333-8333-333333333333.png'
  ) THEN RAISE EXCEPTION 'S2 FAIL: Alpha own PNG rejected'; END IF;
  IF NOT s2_fixture.member_can_access_private_sticker_path(
    's2-fixture-private','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generated_sticker_thumbnails/33333333-3333-4333-8333-333333333333.webp'
  ) THEN RAISE EXCEPTION 'S2 FAIL: Alpha own private WebP rejected'; END IF;
  IF s2_fixture.member_can_access_private_sticker_path(
    's2-fixture-private','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/generated_sticker_thumbnails/44444444-4444-4444-8444-444444444444.webp'
  ) THEN RAISE EXCEPTION 'S2 FAIL: Alpha foreign workspace leaked'; END IF;
  IF s2_fixture.member_can_access_private_sticker_path(
    's2-fixture-private','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reference/33333333-3333-4333-8333-333333333333.png'
  ) THEN RAISE EXCEPTION 'S2 FAIL: wrong folder allowed'; END IF;
  IF s2_fixture.member_can_access_private_sticker_path(
    'not-the-fixture-bucket','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generated_sticker_thumbnails/33333333-3333-4333-8333-333333333333.webp'
  ) THEN RAISE EXCEPTION 'S2 FAIL: wrong bucket allowed'; END IF;
  IF s2_fixture.member_can_access_private_sticker_path(
    's2-fixture-private','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generated_sticker/../../../33333333-3333-4333-8333-333333333333.png'
  ) THEN RAISE EXCEPTION 'S2 FAIL: traversal path allowed'; END IF;
END
$verify_alpha$;
SELECT set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
DO $verify_beta$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM s2_fixture.sticker_assets;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'S2 FAIL: Beta asset visibility'; END IF;
  IF NOT s2_fixture.member_can_access_private_sticker_path(
    's2-fixture-private','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/generated_sticker_thumbnails/44444444-4444-4444-8444-444444444444.webp'
  ) THEN RAISE EXCEPTION 'S2 FAIL: Beta own thumbnail rejected'; END IF;
  IF s2_fixture.member_can_access_private_sticker_path(
    's2-fixture-private','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generated_sticker_thumbnails/33333333-3333-4333-8333-333333333333.webp'
  ) THEN RAISE EXCEPTION 'S2 FAIL: Beta foreign workspace leaked'; END IF;
END
$verify_beta$;
SELECT set_config('request.jwt.claim.sub','',true);
DO $verify_no_session$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM s2_fixture.sticker_assets;
  IF visible_count <> 0 THEN RAISE EXCEPTION 'S2 FAIL: unauthenticated row visibility'; END IF;
  IF s2_fixture.member_can_access_private_sticker_path(
    's2-fixture-private','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generated_sticker_thumbnails/33333333-3333-4333-8333-333333333333.webp'
  ) THEN RAISE EXCEPTION 'S2 FAIL: empty JWT claim granted media access'; END IF;
END
$verify_no_session$;
RESET ROLE;
DO $verify_bucket_and_anon$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets
                 WHERE id='s2-fixture-private' AND public=false
                   AND file_size_limit=2097152) THEN
    RAISE EXCEPTION 'S2 FAIL: no private small bucket';
  END IF;
  IF has_schema_privilege('anon','s2_fixture','USAGE') THEN
    RAISE EXCEPTION 'S2 FAIL: anonymous schema access granted';
  END IF;
  IF (SELECT count(*) FROM storage.objects WHERE bucket_id='s2-fixture-private') <> 0 THEN
    RAISE EXCEPTION 'S2 FAIL: unexpected real Storage objects';
  END IF;
END
$verify_bucket_and_anon$;
ROLLBACK;
