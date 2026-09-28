import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/cartel/LegalDocumentPage";

export const Route = createFileRoute("/legal/refunds")({
  head: () => ({
    meta: [
      { title: "Refund & Cancellation Policy (Draft) — CARTEL HQ" },
      { name: "description", content: "Draft CARTEL HQ Refund & Cancellation Policy. Not effective until legal review and activation." },
      { property: "og:title", content: "Refund & Cancellation Policy (Draft) — CARTEL HQ" },
      { property: "og:description", content: "Draft CARTEL HQ refund and cancellation rules, pending legal review." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalDocumentPage type="refunds" />,
});
