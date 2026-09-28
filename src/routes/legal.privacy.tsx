import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/cartel/LegalDocumentPage";

export const Route = createFileRoute("/legal/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Notice (Draft) — CARTEL HQ" },
      { name: "description", content: "Draft CARTEL HQ Privacy Notice. Not effective until legal review and activation." },
      { property: "og:title", content: "Privacy Notice (Draft) — CARTEL HQ" },
      { property: "og:description", content: "Draft CARTEL HQ Privacy Notice, pending legal review." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalDocumentPage type="privacy" />,
});
