import { createFileRoute } from "@tanstack/react-router";
import { FolderLock } from "lucide-react";
import { PlaceholderPage } from "@/components/cartel/PlaceholderPage";

export const Route = createFileRoute("/_authenticated/assets")({
  head: () => ({
    meta: [
      { title: "Asset Vault — CARTEL HQ" },
      {
        name: "description",
        content: "Asset Vault will store PEPECARTEL artwork, packs, and source files.",
      },
      { property: "og:title", content: "Asset Vault — CARTEL HQ" },
      { property: "og:description", content: "Centralised storage for PEPECARTEL creative assets." },
    ],
  }),
  component: AssetsPage,
});

function AssetsPage() {
  return (
    <PlaceholderPage
      icon={FolderLock}
      eyebrow="Module"
      title="Asset Vault"
      description="Where finished artwork, source files, and exports will live once storage is enabled."
      status="Placeholder"
      availableNow={["Route and navigation entry", "Layout scaffolding for a future asset grid"]}
      plannedLater={[
        "File uploads and storage buckets",
        "Folders, tagging, and search",
        "Export formats and download bundles",
        "Access controls per workspace",
      ]}
    />
  );
}
