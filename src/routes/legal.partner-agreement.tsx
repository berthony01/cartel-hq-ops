import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { LegalDocumentPage } from "@/components/cartel/LegalDocumentPage";
import { effectiveServiceAgreementVersion, fetchPartnerProgramStatus } from "@/lib/partners";

function PartnerAgreementPage() {
  // Fails closed: any error, missing contract or divergent text => Draft.
  const status = useQuery({ queryKey: ["partner-program-status", "agreement"], queryFn: fetchPartnerProgramStatus, staleTime: 60_000 });
  const v = status.data ? effectiveServiceAgreementVersion(status.data) : null;
  return <LegalDocumentPage type="partner_agreement" effectiveVersion={v} />;
}

export const Route = createFileRoute("/legal/partner-agreement")({
  head: () => ({
    meta: [
      { title: "Service Partner Agreement — CARTEL HQ" },
      { name: "description", content: "CARTEL HQ Service Partner Agreement for independent service businesses. The page shows whether the current version is draft or effective." },
      { property: "og:title", content: "Service Partner Agreement — CARTEL HQ" },
      { property: "og:description", content: "CARTEL HQ Service Partner terms for independent service businesses. The Affiliate Program is not open." },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PartnerAgreementPage,
});
