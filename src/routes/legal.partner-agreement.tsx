import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/cartel/LegalDocumentPage";

export const Route = createFileRoute("/legal/partner-agreement")({
  head: () => ({
    meta: [
      { title: "Partner / Affiliate Agreement (Draft) — CARTEL HQ" },
      { name: "description", content: "Draft CARTEL HQ Partner and Affiliate Agreement. Not effective until legal review and activation." },
      { property: "og:title", content: "Partner / Affiliate Agreement (Draft) — CARTEL HQ" },
      { property: "og:description", content: "Draft CARTEL HQ partner program terms, pending legal review." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalDocumentPage type="partner_agreement" />,
});
