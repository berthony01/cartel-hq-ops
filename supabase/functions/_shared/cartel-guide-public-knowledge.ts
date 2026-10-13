/**
 * G2B.0 — Versioned, curated, publicly accessible Cartel HQ Help Center excerpts.
 * Review/staging source only; NO AI API, DB, workspace, member, token, or secret reads.
 * Generated from the *existing public docs* at revision ea5f7ef7b2de64700cff82e2fd15926418f5dd5c.
 * These articles were reviewed on 2026-09-30 and may have changed since.
 * Do not merge or use for customer AI answers until documentation accuracy is re-audited.
 */
export const GUIDE_PUBLIC_DOCS_VERIFIED_AT = "2026-09-30";
export const GUIDE_PUBLIC_DOCS_SOURCE_SHA = "ea5f7ef7b2de64700cff82e2fd15926418f5dd5c";
export type GuideEvidence = {
  articleId: string;
  title: string;
  summary: string;
  excerpt: string;
  href: string;
  verifiedAt: string;
};
type HelpSection = { title: string; body: string[]; steps?: string[]; notice?: string; rows?: string[][] };
type HelpArticle = { id: string; title: string; summary: string; sections: HelpSection[] };
const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    "id": "first-session",
    "title": "Your first session: from account to project foundation",
    "summary": "Follow this sequence to establish the project foundation before using paid tools.",
    "sections": [
      {
        "title": "What you are setting up",
        "body": [
          "A Cartel HQ project is the container for one project identity, its Brand Kit, assets, packs and launches. A Telegram community is a group connected to that project. Several groups under one project share the project identity."
        ]
      },
      {
        "title": "Follow the setup sequence",
        "body": [],
        "steps": [
          "Choose Start Free on the homepage and create your own account. No payment card is needed for Free. If email confirmation is requested, confirm the email before signing in.",
          "In HQ, use the Project selector and Add project. Enter the project name and add it. The new project becomes selected.",
          "Open Guided setup (/onboarding) and choose your goal: Manage My Community, Prepare a Token Launch, or Both. Only the project owner can save the goal; a managed Service Partner cannot. The goal changes which setup steps are shown and can be changed later. It does not unlock or launch anything.",
          "Open Project Profile. Complete the identity and official links, select a logo if you have one, and press Save changes. The saved profile becomes the identity used by relevant project tools.",
          "Community or Both: open Community Command Center, then Telegram. Connect your personal Telegram account if prompted, then connect the group you administer. Check that the group is Ready, then open Welcome & onboarding for that group, configure the welcome and save it. A test sends a real message to the chosen group.",
          "Launch or Both: open Launch Control and create your launch with its date or window. Prepare a Token Launch does not require Telegram; Manage My Community has no launch requirement.",
          "Return to Guided setup or HQ and follow the next incomplete step for your goal. Upgrade only when you want Pro tools and the project identity is complete."
        ]
      },
      {
        "title": "Expected result",
        "body": [
          "You have your own selected project and saved official identity, plus the steps for your goal: a connected Telegram community for Manage My Community or Both, and a launch with its date or window for Prepare a Token Launch or Both. Telegram is not required for Prepare a Token Launch. The setup guide reports your actual progress. Setup never deploys a token automatically, and you do not need to finish token deployment to establish this foundation."
        ]
      },
      {
        "title": "Common mistake",
        "body": [
          "Do not put unrelated tokens or clients in one project just because they use different Telegram groups. Each independent identity should have its own project. Do not share your password with a Service Partner."
        ]
      },
      {
        "title": "Next step",
        "body": [
          "Follow the next incomplete step for your goal. Community projects can configure welcome onboarding, then missions, stickers or broadcasts; launch projects continue in Launch Control and launch communications, according to your plan."
        ]
      }
    ]
  },
  {
    "id": "create-account",
    "title": "Create an account and sign in",
    "summary": "Use the existing email and password flow and complete any email confirmation.",
    "sections": [
      {
        "title": "Create your account",
        "body": [],
        "steps": [
          "Choose Start Free. The account form opens in signup mode and states that Free includes one project and one Telegram community.",
          "Enter an email you can access and choose a password. The current form requires at least six characters; use a strong unique password.",
          "Read the linked Terms and Privacy information. Check the required consent only if you agree, then submit the account form.",
          "If Check your email appears, open the confirmation link sent to that address. You are not signed in until the account is confirmed and the sign-in flow completes.",
          "Sign in using the same email and password. The app opens HQ or the protected destination you originally requested."
        ]
      },
      {
        "title": "Sign in later",
        "body": [],
        "steps": [
          "Choose Sign in on the public homepage, or follow a protected product link.",
          "Enter your existing email and password and press Sign in.",
          "Check the selected project in the header before editing anything."
        ]
      },
      {
        "title": "If confirmation or sign-in fails",
        "body": [
          "Check spam or junk, confirm the address you entered and use the most recent confirmation email. If the link has expired or the form shows an error, follow the displayed message. The audited sign-in form does not expose a self-service password reset button; do not look for a documented reset flow that is not present."
        ]
      },
      {
        "title": "What happens next",
        "body": [
          "Account creation does not connect a Telegram group, create a public token launch or start a subscription. Add your project next."
        ]
      }
    ]
  },
  {
    "id": "create-project",
    "title": "Create or switch projects",
    "summary": "Keep different identities, clients and assets separated using the existing project selector.",
    "sections": [
      {
        "title": "Add a project",
        "body": [],
        "steps": [
          "Open the Project selector at the top of the app.",
          "Choose Add project. The dialog explains that each project separates its profile, Brand Kit, assets, packs, launches and Telegram communities.",
          "Enter Project name and press Add project.",
          "Wait for the success message and the selected project name to change. You become the owner of the new project.",
          "Open Guided setup (/onboarding) and choose Manage My Community, Prepare a Token Launch, or Both, then follow the matching steps. As owner you can change the goal later; a managed Service Partner cannot set it."
        ]
      },
      {
        "title": "Switch before you work",
        "body": [],
        "steps": [
          "Open Project selector. Choose the existing project you want to work on.",
          "Confirm the header name and the project label on the page. Its own data should load.",
          "For a delegated client project, use the managed project access shown to you. Your permissions remain limited to the scopes granted by that client."
        ]
      },
      {
        "title": "Limits and ownership",
        "body": [
          "Free advertises one project and one Telegram community. Do not treat the platform owner account, which has unrestricted access, as a typical customer account. The selector can show multiple projects when your account has access to them; this is not a promise of unlimited new projects under every plan.",
          "There is no audited customer workflow for transferring project ownership. The client should create the project in their own account, then invite a Service Partner."
        ]
      },
      {
        "title": "If the wrong data appears",
        "body": [
          "Confirm the selected project, allow loading to finish and reopen the relevant module. Stop before saving if its project label is wrong."
        ]
      }
    ]
  },
  {
    "id": "project-identity",
    "title": "Set your project’s official identity",
    "summary": "Save the name, ticker, chain, slug and logo used across project surfaces.",
    "sections": [
      {
        "title": "One identity per project",
        "body": [
          "Project Profile holds the official project identity. All Telegram communities attached to that project use it where project branding is shown. The Brand Kit is a separate creative source; later Brand Kit edits do not automatically rewrite the Project Profile."
        ]
      },
      {
        "title": "Set and save identity",
        "body": [],
        "steps": [
          "Open Project Profile and choose Identity in the profile studio.",
          "Enter Project name, Ticker and Primary chain. A ticker is the short project symbol; chain identifies the blockchain you intend to use.",
          "Choose a Public slug using 2 to 64 lowercase letters, numbers or hyphens. It sets the project’s Cartel Network address.",
          "Choose a stored logo or upload an image. General image uploads allow up to 25MB, but branded Telegram broadcasts require PNG or JPEG no larger than 10MB.",
          "If useful, choose Fill empty fields from Brand Kit. Review the copied values; this copies only currently empty fields and is not ongoing synchronization.",
          "Press Save changes. Uploading or selecting a logo and viewing the studio preview alone do not save the identity."
        ]
      },
      {
        "title": "What you should see",
        "body": [
          "The saved profile values become available to relevant project surfaces. The preview shows current form values and may be marked Unsaved until you save."
        ]
      },
      {
        "title": "Common mistakes",
        "body": [
          "A duplicate or invalid slug can prevent saving. A logo that uploads successfully can still be unsuitable for a branded Telegram broadcast. If different tokens need different identities, create separate projects rather than relying on different group names."
        ]
      }
    ]
  },
  {
    "id": "connect-telegram-account",
    "title": "Connect your personal Telegram account",
    "summary": "Link the person administering the bot before connecting a community.",
    "sections": [
      {
        "title": "Why this is separate",
        "body": [
          "Your personal Telegram connection identifies you to the setup flow. It is different from installing the bot into a group. Connecting your account alone does not connect a community."
        ]
      },
      {
        "title": "Connect",
        "body": [],
        "steps": [
          "Open Community Command Center and select Telegram. If your account is not connected, follow the personal Telegram connection step shown there.",
          "Use Connect Telegram to create a fresh one-time connection link. Open the displayed Telegram destination for @PepeCartelHQBot.",
          "In the private bot chat, tap Start. Use the Telegram account you intend to administer the community with.",
          "Return to Cartel HQ. Wait for Telegram account connected or the connected state. Then continue to community setup."
        ]
      },
      {
        "title": "What you should see",
        "body": [
          "The personal account step changes from waiting or pending to connected. Group setup remains a separate step."
        ]
      },
      {
        "title": "Troubleshooting",
        "body": [
          "If Telegram did not open, use the displayed alternative app or web link. If the countdown expires, create a fresh one-time link and use that link. Opening an old bot conversation without tapping Start on the active link does not complete the connection. Do not post the one-time link publicly."
        ]
      }
    ]
  },
  {
    "id": "connect-group",
    "title": "Install the bot and connect a Telegram group",
    "summary": "Connect one group at a time and verify the bot permissions.",
    "sections": [
      {
        "title": "Install and connect",
        "body": [],
        "steps": [
          "Check the active project in the header. Open Community Command Center → Telegram.",
          "Choose Connect Community for the first group, or Connect another community when groups already exist. Follow the active one-time group connection flow.",
          "In Telegram, select the one group you want to connect. Telegram allows one group per add-bot flow.",
          "Add @PepeCartelHQBot as an administrator. Ensure it can Change Group Info and has the permissions required for the actions you intend to use.",
          "If the bot is already installed, open that group and send /cartelhq once while the new one-time link is active.",
          "Return to Cartel HQ and wait for the group to appear. Use Re-check status if needed and verify Ready before publishing or sending.",
          "Repeat Connect another community separately for each additional group your plan permits. Existing connections are retained."
        ]
      },
      {
        "title": "Recognize the correct result",
        "body": [
          "The group appears by its Telegram name under Your communities. Ready means the checked connection requirements are satisfied. Welcome & onboarding opens that group’s own settings."
        ]
      },
      {
        "title": "Basic group or supergroup",
        "body": [
          "Both can receive the published sticker pack link and native sticker messages when verified. Telegram’s official group sticker set is optional and available only to eligible supergroups; it is not required for normal pack-link delivery."
        ]
      },
      {
        "title": "Common mistakes",
        "body": [
          "Using an expired link, selecting the wrong group, adding the bot without administrator rights, or connecting a group under the wrong Cartel HQ project can prevent the intended setup. Re-check the group and project before repeating the flow."
        ]
      },
      {
        "title": "Service Partner boundary",
        "body": [
          "Delegated Community management covers basic welcome controls for groups the client has already connected. It does not allow bot connect, reconnect or disconnect, Telegram administrator-permission setup or Launch Watch CTA settings; those remain with the project owner."
        ]
      }
    ]
  },
  {
    "id": "bot-permissions",
    "title": "Bot permissions, verification and installation messages",
    "summary": "Understand Ready, permissions and the difference between installation and member welcomes.",
    "sections": [
      {
        "title": "Check the setup",
        "body": [],
        "steps": [
          "Open the group’s administrator settings in Telegram and find @PepeCartelHQBot.",
          "Confirm the bot is an administrator and Change Group Info is enabled. Keep the permissions needed to send messages and any enabled mission pinning or cleanup actions. Telegram’s labels can differ by client.",
          "Return to Community Command → Telegram and choose Re-check status for that group.",
          "Expand Capability & technical detail if the group needs attention. Read the returned reason, fix that permission in Telegram and check again."
        ]
      },
      {
        "title": "Installation versus onboarding",
        "body": [
          "An installation or setup message from the bot is different from the configurable welcome sent when a real member joins. After connection, verify the group card in Cartel HQ rather than relying only on a Telegram message. Use Welcome & onboarding to configure future join welcomes.",
          "The audit did not reinstall the bot or trigger a new installation message, so this guide does not promise a particular installation message body or a delivery time."
        ]
      },
      {
        "title": "Permission-specific limits",
        "body": [
          "The optional official sticker set depends on Telegram’s supergroup eligibility. Mission pinning and command cleanup depend on the bot’s corresponding group permissions. A permission change after setup can break future actions, so check again after changing group administration."
        ]
      },
      {
        "title": "Next step",
        "body": [
          "Save the welcome settings and, if you choose, send a real test to a group you control."
        ]
      },
      {
        "title": "Service Partner boundary",
        "body": [
          "Delegated Community management covers basic welcome controls for groups the client has already connected. It does not allow bot connect, reconnect or disconnect, Telegram administrator-permission setup or Launch Watch CTA settings; those remain with the project owner."
        ]
      }
    ]
  },
  {
    "id": "welcome-message",
    "title": "Configure member welcomes and the Launch Watch invitation",
    "summary": "Customize each group’s join welcome and optional separate Launch Watch card.",
    "sections": [
      {
        "title": "Set the member welcome",
        "body": [],
        "steps": [
          "Open Welcome & onboarding on the intended group card. Check the community name in the dialog.",
          "Enable welcomes for real member joins if you want automatic welcomes.",
          "Write the Message in plain text, up to 3,500 characters. Supported placeholders are {first_name}, {username}, {member} and {community_name}.",
          "Choose whether to mention the new member. If using auto-delete, select the displayed delay; the current implementation permits 10 to 120 seconds.",
          "Press Save to store that group’s settings. The configuration applies to future qualifying joins.",
          "Use Send test welcome only when you are ready for a real test message in that group. Review the Telegram result; saving alone is not a test send."
        ]
      },
      {
        "title": "Add an optional Launch Watch card",
        "body": [],
        "steps": [
          "Enable the separate Launch Watch card and select an eligible launch in the dialog.",
          "Choose which saved Website, Telegram and X links to include when available.",
          "Choose the card lifetime: 5, 10, 15, 30 or 60 minutes. Save the settings.",
          "When a member receives the invitation, they must follow its private bot link and tap Start to opt in. Joining the group alone does not subscribe them."
        ]
      },
      {
        "title": "Important distinction",
        "body": [
          "The join welcome and Launch Watch card are separate messages. Their settings are per community. Countdown mute and Stop Watching remain in the member’s private Launch Watch message, not in a public group welcome."
        ]
      },
      {
        "title": "If a button or link is missing",
        "body": [
          "Save the official link in Project Profile first. Confirm the selected launch is eligible and the bot is Ready in this group. Plain text does not interpret HTML or Markdown tags as formatting."
        ]
      },
      {
        "title": "Service Partner boundary",
        "body": [
          "Delegated Community management covers basic welcome controls for groups the client has already connected. It does not allow bot connect, reconnect or disconnect, Telegram administrator-permission setup or Launch Watch CTA settings; those remain with the project owner."
        ]
      }
    ]
  }
];

const STOP_WORDS = new Set([
  "a","an","and","are","can","could","do","does","for","from","help","how","i","in",
  "is","it","me","my","of","on","or","please","the","this","to","what","when",
  "where","which","with","you","your"
]);
const LIMIT_EXCERPT_CHARS = 1350;
export function getGuidePublicArticleIds(): string[] {
  return HELP_ARTICLES.map((a) => a.id);
}
/** Deterministic retrieval; never authorizes actions or sends data to a model. */
export function findGuidePublicEvidence(question: string, maxArticles = 3): GuideEvidence[] {
  if (typeof question !== "string" || question.length > 500) return [];
  const terms = [...new Set((question.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w)))].slice(0, 14);
  if (!terms.length) return [];
  const ranked = HELP_ARTICLES.map((doc) => {
    const title = doc.title.toLowerCase();
    const summary = doc.summary.toLowerCase();
    const sections = doc.sections.map(s =>
      [s.title, ...s.body, ...(s.steps ?? []), ...(s.rows ?? []).flat(), s.notice ?? ""]
      .join(" ")).join(" ").toLowerCase();
    const matches = terms.filter(term => title.includes(term) || summary.includes(term) || sections.includes(term));
    const score = matches.reduce((acc,term) =>
      acc + (title.includes(term) ? 6 : 0) + (summary.includes(term) ? 3 : 0) +
      (sections.includes(term) ? 1 : 0), 0);
    return { doc, score, matchCount: matches.length };
  }).filter(x => x.score > 0 && x.matchCount >= Math.min(2, terms.length))
    .sort((a,b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
  const exactTitleMatches = terms.length >= 2
    ? ranked.filter(x => terms.every(term => x.doc.title.toLowerCase().includes(term)))
    : [];
  const grounded = exactTitleMatches.length > 0 ? exactTitleMatches : ranked;
  const bounded = Number.isFinite(maxArticles) ? Math.min(4, Math.max(1, Math.floor(maxArticles))) : 3;
  return grounded.slice(0, bounded).map(({doc}) => {
    // Public help article content only. No accounts, messages, wallets or project records.
    const sectionText = doc.sections.map(s => [
      s.title, ...s.body, ...(s.steps ?? []),
      ...(s.rows ?? []).map(r => r.join(" — ")),
      ...(s.notice ? [s.notice] : []),
    ].join("\n")).join("\n\n");
    return {
      articleId: doc.id,
      title: doc.title,
      summary: doc.summary,
      excerpt: sectionText.slice(0, LIMIT_EXCERPT_CHARS),
      href: "/docs?article=" + encodeURIComponent(doc.id),
      verifiedAt: GUIDE_PUBLIC_DOCS_VERIFIED_AT,
    };
  });
}
