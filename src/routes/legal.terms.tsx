import { createFileRoute } from "@tanstack/react-router";
import { LegalDocumentPage } from "@/components/cartel/LegalDocumentPage";

export const Route = createFileRoute("/legal/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service (Draft) — CARTEL HQ" },
      { name: "description", content: "Draft CARTEL HQ Terms of Service. Not effective until legal review and activation." },
      { property: "og:title", content: "Terms of Service (Draft) — CARTEL HQ" },
      { property: "og:description", content: "Draft CARTEL HQ Terms of Service, pending legal review." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <LegalDocumentPage type="terms" />,
});
