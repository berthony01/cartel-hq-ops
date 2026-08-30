CREATE TABLE public.platform_message_templates (
  key text PRIMARY KEY CHECK (key IN ('bot_installed','account_found','community_connected')),
  draft_body text NOT NULL CHECK (char_length(draft_body) <= 3500),
  published_body text CHECK (published_body IS NULL OR (char_length(published_body) BETWEEN 1 AND 3500)),
  draft_updated_at timestamptz,
  published_at timestamptz,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.platform_message_templates FROM anon;
REVOKE ALL ON public.platform_message_templates FROM authenticated;
GRANT ALL ON public.platform_message_templates TO service_role;

ALTER TABLE public.platform_message_templates ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER platform_message_templates_set_updated_at
BEFORE UPDATE ON public.platform_message_templates
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.platform_message_templates (key, draft_body) VALUES
('bot_installed', E'<b>\U0001F438 PEPECARTEL HQ BOT INSTALLED</b>\n\n<b>{group_title}</b> has added @PepeCartelHQBot.\n\nThis community is <b>not connected to a Cartel HQ workspace yet.</b>\n\nCartel HQ is the command center where community owners configure tools and automations. The bot carries approved actions out here in Telegram.\n\n<b>Available through Cartel HQ</b>\n\U0001F44B Welcome &amp; onboarding\n\U0001F3A8 Telegram sticker packs\n\U0001F916 Native Sticker Drops\n\n<b>Coming next</b>\n\U0001F4E2 Community automations\n\U0001F680 Launch Watch &amp; official launch alerts\n\U0001F6E1 Project verification\n\nNew to Cartel HQ? Join Early Access below. Already have an account? Connect your Telegram account in Cartel HQ, then connect this community from your workspace.'),
('account_found', E'<b>\U0001F438 CARTEL HQ ACCOUNT FOUND</b>\n\nWe recognize the Cartel HQ account linked to the Telegram user who added @PepeCartelHQBot to <b>{group_title}</b>.\n\nThis community is <b>not connected to a Cartel HQ workspace yet.</b>\n\nReturn to Cartel HQ and use <b>Connect Community</b> from the workspace that should control this group. Once verified, the bot will activate that workspace''s approved community tools here.'),
('community_connected', E'<b>\u2705 CARTEL HQ CONNECTED</b>\n\n<b>{group_title}</b> is now connected to Cartel HQ.\n\n\U0001F438 <b>@PepeCartelHQBot is active in this community.</b>\n\nCommunity owners configure tools and automations inside <b>Cartel HQ</b>, and the bot carries them out here in Telegram.\n\n<b>Available now</b>\n\U0001F44B Welcome &amp; onboarding\n\U0001F3A8 Telegram sticker packs\n\U0001F916 Native Sticker Drops\n\n<b>Coming through Cartel HQ</b>\n\U0001F4E2 Community automations\n\U0001F4CA Polls, milestones &amp; community intelligence\n\U0001F680 Launch Watch &amp; official launch alerts\n\U0001F6E1 Project verification\n\u26A1 More community &amp; launch tools\n\nReturn to Cartel HQ to configure this community.');