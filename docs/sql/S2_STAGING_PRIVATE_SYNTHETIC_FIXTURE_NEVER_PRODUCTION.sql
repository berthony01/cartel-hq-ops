-- STAGING ONLY / NEVER production. Synthetic SQL-only membership + Storage policy fixture.
-- Intended project: llicojkxpzwylghptmkf (CARTEL HQ STAGING).
-- This does NOT create auth.users, real Storage objects, or a hosted frontend.
BEGIN;
DO $guard$
BEGIN
  IF to_regclass('public.media_assets') IS NOT NULL
     OR to_regclass('public.sticker_packs') IS NOT NULL
     OR to_regnamespace('s2_fixture') IS NOT NULL
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id='s2-fixture-private')
  THEN
    RAISE EXCEPTION 'STOP: S2 fixture is not an empty isolated staging target';
  END IF;
END
$guard$;

CREATE SCHEMA s2_fixture;
REVOKE ALL ON SCHEMA s2_fixture FROM PUBLIC;
GRANT USAGE ON SCHEMA s2_fixture TO authenticated;

CREATE TABLE s2_fixture.workspaces (
 id uuid PRIMARY KEY,
 label text NOT NULL,
 CONSTRAINT s2_only_labels CHECK (label IN ('S2 Alpha Synthetic','S2 Beta Synthetic'))
);
CREATE TABLE s2_fixture.memberships (
 workspace_id uuid NOT NULL REFERENCES s2_fixture.workspaces(id),
 user_id uuid NOT NULL,
 PRIMARY KEY (workspace_id,user_id)
);
CREATE TABLE s2_fixture.sticker_assets (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES s2_fixture.workspaces(id),
 original_path text NOT NULL UNIQUE,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 CONSTRAINT s2_assets_synthetic_only CHECK (original_path LIKE '%/generated_sticker/%')
);
CREATE INDEX sticker_assets_workspace_id_idx ON s2_fixture.sticker_assets(workspace_id);
ALTER TABLE s2_fixture.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE s2_fixture.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE s2_fixture.sticker_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA s2_fixture FROM PUBLIC,anon,authenticated;
GRANT SELECT ON s2_fixture.workspaces,s2_fixture.memberships,s2_fixture.sticker_assets TO authenticated;

CREATE POLICY s2_member_self_read ON s2_fixture.memberships
 FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY s2_workspace_read ON s2_fixture.workspaces
 FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM s2_fixture.memberships m
   WHERE m.workspace_id=id AND m.user_id=(SELECT auth.uid()))
 );
CREATE POLICY s2_assets_read ON s2_fixture.sticker_assets
 FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM s2_fixture.memberships m
   WHERE m.workspace_id=sticker_assets.workspace_id AND m.user_id=(SELECT auth.uid()))
 );

-- This is SECURITY INVOKER: RLS on memberships must still pass.
CREATE FUNCTION s2_fixture.member_can_access_private_sticker_path(
  _bucket text, _path text
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = '' AS $policy$
 SELECT _bucket='s2-fixture-private' AND EXISTS (
  SELECT 1 FROM s2_fixture.memberships m
  WHERE m.user_id=(SELECT auth.uid())
    AND (
     _path ~ ('^' || m.workspace_id::text || '/generated_sticker/[a-z0-9-]{1,110}[.]png$')
     OR _path ~ ('^' || m.workspace_id::text || '/generated_sticker_thumbnails/[a-z0-9-]{1,110}[.]webp$')
    )
 );
$policy$;
REVOKE ALL ON FUNCTION s2_fixture.member_can_access_private_sticker_path(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION s2_fixture.member_can_access_private_sticker_path(text,text) TO authenticated;

-- Metadata only for the test bucket; no blob objects are created by this SQL.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('s2-fixture-private','s2-fixture-private',false,2097152,ARRAY['image/png','image/webp']);

-- Narrow allow policies for the PRIVATE bucket and two exact image folders.
CREATE POLICY s2_fixture_obj_read ON storage.objects
 FOR SELECT TO authenticated
 USING (s2_fixture.member_can_access_private_sticker_path(bucket_id,name));
CREATE POLICY s2_fixture_obj_insert ON storage.objects
 FOR INSERT TO authenticated
 WITH CHECK (s2_fixture.member_can_access_private_sticker_path(bucket_id,name));
-- No UPDATE or DELETE access is granted by this S2 testing fixture.
-- The real production bucket's independent existing policies are unchanged.

INSERT INTO s2_fixture.workspaces(id,label) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','S2 Alpha Synthetic'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','S2 Beta Synthetic');
INSERT INTO s2_fixture.memberships(workspace_id,user_id) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
INSERT INTO s2_fixture.sticker_assets(id,workspace_id,original_path,metadata) VALUES
('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/generated_sticker/33333333-3333-4333-8333-333333333333.png','{"synthetic":true}'::jsonb),
('44444444-4444-4444-8444-444444444444','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/generated_sticker/44444444-4444-4444-8444-444444444444.png','{"synthetic":true}'::jsonb);
COMMIT;
