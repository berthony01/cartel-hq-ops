import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/cartel/LegalDocumentPage";

export const Route = createFileRoute("/legal/partner-agreement")({
  head: () => ({
    meta: [
      { title: "Service Partner Agreement (Draft) — CARTEL HQ" },
      { name: "description", content: "Draft CARTEL HQ Service Partner Agreement for independent service businesses. Not effective until legal review and activation." },
      { property: "og:title", content: "Service Partner Agreement (Draft) — CARTEL HQ" },
      { property: "og:description", content: "Draft CARTEL HQ Service Partner terms, pending legal review. The Affiliate Program is not open." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalDocumentPage type="partner_agreement" />,
});
