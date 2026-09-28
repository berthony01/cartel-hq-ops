/**
 * Partner Program Phase 1B-1 — draft legal/policy documents.
 *
 * These are DRAFTS. They are not effective until an owner activates a
 * versioned, placeholder-free copy through the staged policy_documents
 * contract (docs/sql/PARTNER_1B_1_policy_acceptance.sql, NOT APPLIED).
 * Legal operator identity is unknown: every such field is a visible
 * [PLACEHOLDER]. "CARTEL HQ" is a product name, never a legal entity here.
 */

export type PolicyType = "terms" | "privacy" | "refunds" | "partner_agreement";

export type PolicySection = { heading: string; body: string[] };
export type PolicyDraft = {
  type: PolicyType;
  title: string;
  path: "/legal/terms" | "/legal/privacy" | "/legal/refunds" | "/legal/partner-agreement";
  summary: string;
  draftVersion: number;
  sections: PolicySection[];
};

export const REQUIRED_PLACEHOLDERS = [
  "[LEGAL OPERATOR NAME]",
  "[MAILING ADDRESS]",
  "[LEGAL CONTACT EMAIL]",
  "[STATE OF FORMATION]",
  "[GOVERNING LAW]",
] as const;

/** Any bracketed ALL-CAPS token counts as an unresolved placeholder. */
export const PLACEHOLDER_RE = /\[[A-Z0-9][A-Z0-9 /&.,'-]*\]/g;

const OPERATOR = "[LEGAL OPERATOR NAME]";

const IDENTITY: PolicySection = {
  heading: "Who we are",
  body: [
    `These documents are offered by ${OPERATOR}, a [ENTITY TYPE] formed under the laws of [STATE OF FORMATION] ("Operator", "we", "us"), which operates the CARTEL HQ software service.`,
    "Mailing address: [MAILING ADDRESS]. Legal contact: [LEGAL CONTACT EMAIL].",
  ],
};

const NO_ADVICE: PolicySection = {
  heading: "No financial, investment, legal or tax advice",
  body: [
    "CARTEL HQ is a software tool for project communications and operations. Nothing in the service, its content, notifications, badges, launch pages or communications is financial, investment, legal, tax or accounting advice, or a recommendation to buy, sell or hold any digital asset.",
    "We do not promise or imply the safety, legitimacy, success, liquidity, price, returns or future value of any token or project. Labels such as \"Official contract registered by the authenticated project\" only describe information the project supplied; they are not an audit, endorsement or guarantee.",
    "We do not promise uninterrupted uptime or the availability, accuracy or behavior of any third-party service, blockchain, wallet, exchange or network.",
  ],
};

const USER_RESPONSIBILITY: PolicySection = {
  heading: "Your responsibilities",
  body: [
    "You are solely responsible for your wallets, private keys, seed phrases, signing permissions, approvals and transactions, for the content you create or publish, and for complying with laws and platform rules that apply to you and your project, including securities, consumer-protection, advertising and sanctions laws.",
    "Blockchain transactions are generally irreversible. We never ask for your private keys or seed phrases.",
  ],
};

const THIRD_PARTY: PolicySection = {
  heading: "Third-party services",
  body: [
    "The service integrates with third parties (for example Telegram, X, Stripe, blockchain networks, wallet providers and hosting/infrastructure vendors). Those services have their own terms and data practices, which govern your use of them. We are not responsible for third-party services, outages or changes.",
  ],
};

const GOVERNING: PolicySection = {
  heading: "Governing law and disputes",
  body: [
    "These terms are governed by [GOVERNING LAW], without regard to conflict-of-laws rules. Dispute resolution forum and procedure: [DISPUTE RESOLUTION FORUM AND PROCEDURE].",
  ],
};

export const POLICY_DRAFTS: Record<PolicyType, PolicyDraft> = {
  terms: {
    type: "terms",
    title: "Terms of Service",
    path: "/legal/terms",
    summary: "The rules for using CARTEL HQ, including accounts, plans, acceptable use and disclaimers.",
    draftVersion: 1,
    sections: [
      IDENTITY,
      {
        heading: "Accounts and workspaces",
        body: [
          "You must provide accurate information, keep your credentials secure and be old enough to form a binding contract where you live. You are responsible for activity in your account and workspaces, including actions by members you invite.",
        ],
      },
      {
        heading: "Plans and billing",
        body: [
          "CARTEL HQ Free costs $0. CARTEL HQ Pro is billed at USD $49 per month per workspace, plus any applicable taxes, through our payment processor. Pro renews monthly until cancelled. Refunds and cancellations are governed by the Refund & Cancellation Policy.",
        ],
      },
      {
        heading: "Acceptable use",
        body: [
          "You may not use the service for fraud, market manipulation, wash trading, fake engagement, spam, impersonation, malware, unlawful content, sanctions evasion, or to infringe others' rights. We may suspend or terminate accounts that violate these terms.",
        ],
      },
      NO_ADVICE,
      USER_RESPONSIBILITY,
      THIRD_PARTY,
      {
        heading: "Disclaimers and limitation of liability",
        body: [
          "To the extent permitted by law, the service is provided \"as is\" and \"as available\" without warranties of any kind. To the extent permitted by law, the Operator's total liability for any claim is limited to the amount you paid for the service in the [LIABILITY LOOKBACK PERIOD] before the claim, and the Operator is not liable for indirect, incidental, consequential or lost-profit damages, or for losses from digital assets, wallets or third-party services.",
        ],
      },
      { heading: "Changes", body: ["We may update these terms. Material changes take effect when a new version is activated; where required you will be asked to accept it."] },
      GOVERNING,
    ],
  },
  privacy: {
    type: "privacy",
    title: "Privacy Notice",
    path: "/legal/privacy",
    summary: "What information CARTEL HQ collects, why, who processes it, and your choices.",
    draftVersion: 1,
    sections: [
      IDENTITY,
      {
        heading: "Categories of information",
        body: [
          "Account data (email address, authentication identifiers); workspace and project data you enter (project identity, launch details, links, media); Telegram identifiers and group information when you connect Telegram; billing records (plan, subscription status and payment-processor references — card details are handled by the payment processor, not stored by us); usage and technical logs; partner-program records if you apply (application, role, referral records, ledger and payout records).",
        ],
      },
      {
        heading: "Purposes",
        body: [
          "To provide and secure the service, authenticate users, process payments, deliver notifications you request, operate the partner program, prevent fraud and abuse, comply with legal obligations, and improve the service.",
        ],
      },
      {
        heading: "Service providers and processors",
        body: [
          "We share information with service providers that process it on our behalf, such as hosting and database providers, authentication and email delivery providers, payment processors, messaging platforms (for example Telegram) and AI/model providers used for features you invoke. We may disclose information when required by law, to protect rights and safety, or in a business transfer. [LIST OF PROCESSORS AND SALE/SHARING DETERMINATION — PENDING LEGAL REVIEW].",
        ],
      },
      {
        heading: "International transfers",
        body: [
          "Our vendors may process information in countries other than yours, including the United States. Where required, transfers rely on appropriate safeguards. [TRANSFER MECHANISMS — PENDING LEGAL REVIEW].",
        ],
      },
      {
        heading: "Local storage and referral tokens",
        body: [
          "The app uses browser local storage to keep you signed in and remember preferences. If you arrive through a partner referral link, the browser stores a referral reference and its expiry so attribution can be confirmed after sign-up. We do not collect IP addresses or device fingerprints for referral attribution.",
        ],
      },
      {
        heading: "Security",
        body: ["We use access controls, encryption in transit and least-privilege practices. No system is perfectly secure, and we cannot guarantee absolute security."],
      },
      {
        heading: "Retention",
        body: ["We keep information for as long as needed for the purposes above, including legal, tax, accounting and fraud-prevention obligations, then delete or de-identify it. [RETENTION SCHEDULE — PENDING LEGAL REVIEW]."],
      },
      {
        heading: "Your rights",
        body: [
          "Depending on where you live, you may have rights to access, correct, delete, or port your information, and to object to or restrict certain processing. Contact [LEGAL CONTACT EMAIL]. We will not discriminate against you for exercising these rights.",
        ],
      },
      GOVERNING,
    ],
  },
  refunds: {
    type: "refunds",
    title: "Refund & Cancellation Policy",
    path: "/legal/refunds",
    summary: "How cancellations work and when fees can be refunded.",
    draftVersion: 1,
    sections: [
      IDENTITY,
      {
        heading: "Cancellation",
        body: [
          "You can cancel CARTEL HQ Pro at any time from Manage Billing. Cancellation takes effect at the end of the current billing period; Pro features remain available until then. There are no prorated refunds or credits for unused time.",
        ],
      },
      {
        heading: "Refunds",
        body: [
          "To the extent permitted by law, fees are generally non-refundable once billed, except: (a) duplicate charges; (b) unauthorized charges; (c) refunds required by applicable law; and (d) where the Operator fails to provide the purchased access and does not cure that failure after notice.",
          "Any discretionary credit or refund we choose to give does not create an obligation or precedent for future requests.",
        ],
      },
      { heading: "How to request", body: ["Contact [LEGAL CONTACT EMAIL] with your account email and the charge details."] },
      GOVERNING,
    ],
  },
  partner_agreement: {
    type: "partner_agreement",
    title: "Partner / Affiliate Agreement",
    path: "/legal/partner-agreement",
    summary: "Terms for approved CARTEL HQ affiliates and service partners.",
    draftVersion: 1,
    sections: [
      IDENTITY,
      {
        heading: "Application and approval",
        body: [
          "Participation requires an application and written approval by the Operator. Affiliate and Service Partner are distinct roles. Service Partners charge their own clients separately, gain no access to client workspaces through this program, and earn no CARTEL HQ commission unless separately approved as an Affiliate.",
        ],
      },
      {
        heading: "Eligible referrals and attribution",
        body: [
          "A referral is eligible only when a new customer first reaches CARTEL HQ through your server-verified referral link within the attribution window of 30 days, and then creates a new workspace. The first valid attribution wins and is not overwritten. Existing customers, existing workspaces and your own accounts are not eligible.",
        ],
      },
      {
        heading: "Prohibited practices",
        body: [
          "Prohibited: self-referral or referring accounts you control; cookie stuffing, forced clicks or hidden links; spam or unsolicited messages; misleading, false or unsubstantiated claims (including claims of token safety, returns or endorsement); bidding on CARTEL HQ or PEPECARTEL brand terms in paid search; and impersonating the Operator.",
        ],
      },
      {
        heading: "Required disclosure",
        body: [
          "You must clearly and conspicuously disclose your material connection to CARTEL HQ wherever you promote it, consistent with the U.S. FTC Endorsement Guides — for example: \"I earn a commission if you subscribe through my link.\"",
        ],
      },
      {
        heading: "Commission",
        body: [
          "Commission is 20% of qualifying revenue for the first 12 successfully paid monthly invoices per referred workspace. Qualifying revenue is subscription revenue actually collected for the CARTEL HQ plan, excluding sales tax, discounts, credits, refunds, chargebacks/disputes and setup or service fees. Processor fees do not reduce the commission base. Commission never accrues from a checkout alone.",
        ],
      },
      {
        heading: "Hold, minimum and payout",
        body: [
          "Accrued commission is held for 45 days before it becomes available. The minimum payout is USD $50. Payouts are requested by you and reviewed and paid manually by the Operator, generally monthly, in USD.",
        ],
      },
      {
        heading: "Taxes",
        body: [
          "You are responsible for your own taxes. Before any payout, you must complete tax readiness (for example an IRS Form W-9 or applicable equivalent) through an external secure process designated by the Operator. CARTEL HQ does not collect or store taxpayer identification numbers in the app.",
        ],
      },
      {
        heading: "Refunds, disputes and reversals",
        body: [
          "If qualifying revenue is refunded or disputed, the related commission is reversed proportionally by a new ledger entry. Reversals after payout create a negative balance that carries forward against future commission. Ledger history is never deleted or rewritten.",
        ],
      },
      {
        heading: "Termination and fraud",
        body: [
          "Either party may terminate at any time. The Operator may suspend, reject referrals or withhold unpaid commission for fraud or breach of this agreement.",
        ],
      },
      {
        heading: "Relationship, IP and confidentiality",
        body: [
          "You are an independent contractor, not an employee, agent, partner or joint venturer, and cannot bind the Operator. You receive a limited, revocable license to use approved brand assets only for promotion under this agreement. You must keep non-public program information confidential and handle any personal data in compliance with applicable privacy law.",
        ],
      },
      {
        heading: "Disclaimers, limitation and indemnity",
        body: [
          "The program is provided \"as is\" to the extent permitted by law. The Operator's liability is limited to unpaid commission properly owed. You will indemnify the Operator against claims arising from your promotions, breach or violation of law.",
        ],
      },
      GOVERNING,
    ],
  },
};

export const POLICY_TYPES: PolicyType[] = ["terms", "privacy", "refunds", "partner_agreement"];

/** Canonical text used for hashing and placeholder scanning. */
export function policyContent(draft: PolicyDraft): string {
  return [draft.title, ...draft.sections.flatMap((s) => [s.heading, ...s.body])].join("\n");
}

export function findPlaceholders(text: string): string[] {
  return Array.from(new Set(text.match(PLACEHOLDER_RE) ?? []));
}

/** Fail closed: activation is only possible with zero placeholders. */
export function canActivatePolicy(text: string): boolean {
  return findPlaceholders(text).length === 0;
}

export function activationConfirmPhrase(type: PolicyType, version: number): string {
  return `ACTIVATE ${type.toUpperCase()} V${version}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
