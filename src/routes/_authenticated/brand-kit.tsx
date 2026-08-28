import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Palette, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/useSession";
import { useWorkspace } from "@/lib/workspace-context";
import {
  listWorkspaceAssets,
  signedUrlMap,
  type AssetType,
  type MediaAsset,
} from "@/lib/media";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { AssetUploader } from "@/components/cartel/AssetUploader";
import { Section } from "@/components/cartel/Section";
import { StickyActionBar } from "@/components/cartel/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/brand-kit")({
  head: () => ({
    meta: [
      { title: "Brand Kit — CARTEL HQ" },
      {
        name: "description",
        content: "Brand Kit holds the PEPECARTEL palette, type, marks, links, and AI style rules.",
      },
      { property: "og:title", content: "Brand Kit — CARTEL HQ" },
      {
        property: "og:description",
        content: "Central brand system for PEPECARTEL creative output.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BrandKitPage,
});

type BrandKitForm = {
  brand_name: string;
  ticker: string;
  description: string;
  website_url: string;
  x_url: string;
  telegram_url: string;
  colors: string;
  fonts: string;
  ai_style_notes: string;
  approved_phrases: string;
  prohibited_styles: string;
};

const EMPTY_FORM: BrandKitForm = {
  brand_name: "",
  ticker: "",
  description: "",
  website_url: "",
  x_url: "",
  telegram_url: "",
  colors: "",
  fonts: "",
  ai_style_notes: "",
  approved_phrases: "",
  prohibited_styles: "",
};

const toList = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);

const fromList = (value: unknown): string =>
  Array.isArray(value) ? value.map((v) => String(v)).join(", ") : "";

const nullable = (value: string): string | null => (value.trim() ? value.trim() : null);

const BRAND_ASSET_TYPES: AssetType[] = ["logo", "mascot", "reference_image"];

function BrandKitPage() {
  const { workspaceId, workspace, loading: workspaceLoading } = useWorkspace();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BrandKitForm>(EMPTY_FORM);

  const brandKitQuery = useQuery({
    queryKey: ["brand-kit", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("brand_kits")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const assetsQuery = useQuery({
    queryKey: ["brand-assets", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const all = await listWorkspaceAssets(workspaceId!);
      return all.filter((a) => BRAND_ASSET_TYPES.includes(a.asset_type as AssetType));
    },
  });

  const brandAssets = useMemo(() => assetsQuery.data ?? [], [assetsQuery.data]);

  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    if (brandAssets.length === 0) {
      setUrls({});
      return;
    }
    signedUrlMap(brandAssets.map((a) => a.storage_path)).then((map) => {
      if (active) setUrls(map);
    });
    return () => {
      active = false;
    };
  }, [brandAssets]);

  const loaded = brandKitQuery.data;
  useEffect(() => {
    if (!loaded) {
      setForm(EMPTY_FORM);
      return;
    }
    setForm({
      brand_name: loaded.brand_name ?? "",
      ticker: loaded.ticker ?? "",
      description: loaded.description ?? "",
      website_url: loaded.website_url ?? "",
      x_url: loaded.x_url ?? "",
      telegram_url: loaded.telegram_url ?? "",
      colors: fromList(loaded.colors),
      fonts: fromList(loaded.fonts),
      ai_style_notes: loaded.ai_style_notes ?? "",
      approved_phrases: fromList(loaded.approved_phrases),
      prohibited_styles: fromList(loaded.prohibited_styles),
    });
  }, [loaded]);

  const save = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error("No active workspace.");
      const payload = {
        workspace_id: workspaceId,
        brand_name: form.brand_name.trim(),
        ticker: nullable(form.ticker),
        description: nullable(form.description),
        website_url: nullable(form.website_url),
        x_url: nullable(form.x_url),
        telegram_url: nullable(form.telegram_url),
        colors: toList(form.colors),
        fonts: toList(form.fonts),
        ai_style_notes: nullable(form.ai_style_notes),
        approved_phrases: toList(form.approved_phrases),
        prohibited_styles: toList(form.prohibited_styles),
      };

      if (loaded?.id) {
        const { error } = await supabase.from("brand_kits").update(payload).eq("id", loaded.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("brand_kits").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Brand Kit saved");
      queryClient.invalidateQueries({ queryKey: ["brand-kit", workspaceId] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not save the Brand Kit.");
    },
  });

  const set = (patch: Partial<BrandKitForm>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-6 pb-24 sm:space-y-8 lg:pb-0">
      <PageHeader
        eyebrow="Module"
        title="Brand Kit"
        description="A single source of truth for PEPECARTEL colour, type, marks, links, and AI style rules. One Brand Kit per workspace."
        status={workspace ? workspace.name : "No workspace"}
      />

      {!workspaceLoading && !workspaceId ? (
        <EmptyState
          icon={Palette}
          title="No workspace yet"
          description="Create a workspace from the switcher in the header before setting up a Brand Kit."
        />
      ) : (
        <>
          <form
            id="brand-kit-form"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="space-y-4 sm:space-y-6"
          >
            <Section variant="surface" title="Identity">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="brand_name">Brand name</Label>
                  <Input
                    id="brand_name"
                    required
                    className="mt-2 min-h-11"
                    value={form.brand_name}
                    onChange={(e) => set({ brand_name: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="ticker">Ticker</Label>
                  <Input
                    id="ticker"
                    className="mt-2 min-h-11"
                    placeholder="$PCART"
                    value={form.ticker}
                    onChange={(e) => set({ ticker: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    className="mt-2"
                    rows={3}
                    value={form.description}
                    onChange={(e) => set({ description: e.target.value })}
                  />
                </div>
              </div>
            </Section>

            <Section variant="surface" title="Links">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="website_url">Website</Label>
                  <Input
                    id="website_url"
                    type="url"
                    className="mt-2 min-h-11"
                    value={form.website_url}
                    onChange={(e) => set({ website_url: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="x_url">X profile</Label>
                  <Input
                    id="x_url"
                    type="url"
                    className="mt-2 min-h-11"
                    value={form.x_url}
                    onChange={(e) => set({ x_url: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="telegram_url">Telegram</Label>
                  <Input
                    id="telegram_url"
                    type="url"
                    className="mt-2 min-h-11"
                    value={form.telegram_url}
                    onChange={(e) => set({ telegram_url: e.target.value })}
                  />
                </div>
              </div>
            </Section>

            <Section variant="surface" title="Visual system">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="colors">Colours</Label>
                  <Textarea
                    id="colors"
                    rows={3}
                    className="mt-2"
                    placeholder="#D4A82A, #D92027, #4BAE4F"
                    aria-describedby="colors-help"
                    value={form.colors}
                    onChange={(e) => set({ colors: e.target.value })}
                  />
                  <p id="colors-help" className="mt-2 text-xs text-muted-foreground">
                    Comma or newline separated.
                  </p>
                </div>
                <div>
                  <Label htmlFor="fonts">Fonts</Label>
                  <Textarea
                    id="fonts"
                    rows={3}
                    className="mt-2"
                    placeholder="Bebas Neue, Sora"
                    value={form.fonts}
                    onChange={(e) => set({ fonts: e.target.value })}
                  />
                </div>
                {form.colors.trim() ? (
                  <div className="flex flex-wrap gap-2 md:col-span-2">
                    {toList(form.colors).map((c) => (
                      <span
                        key={c}
                        className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground"
                      >
                        <span
                          className="size-4 rounded-sm border border-border"
                          style={{ background: c }}
                          aria-hidden="true"
                        />
                        {c}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Section>

            <Section variant="surface" title="AI style guidance">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label htmlFor="ai_style_notes">Style notes</Label>
                  <Textarea
                    id="ai_style_notes"
                    rows={4}
                    className="mt-2"
                    value={form.ai_style_notes}
                    onChange={(e) => set({ ai_style_notes: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="approved_phrases">Approved phrases</Label>
                  <Textarea
                    id="approved_phrases"
                    rows={3}
                    className="mt-2"
                    value={form.approved_phrases}
                    onChange={(e) => set({ approved_phrases: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="prohibited_styles">Prohibited styles</Label>
                  <Textarea
                    id="prohibited_styles"
                    rows={3}
                    className="mt-2"
                    value={form.prohibited_styles}
                    onChange={(e) => set({ prohibited_styles: e.target.value })}
                  />
                </div>
              </div>
            </Section>

            <div className="hidden items-center gap-3 lg:flex">
              <Button
                type="submit"
                className="min-h-11"
                disabled={save.isPending || brandKitQuery.isLoading || !form.brand_name.trim()}
              >
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                {loaded ? "Save changes" : "Create Brand Kit"}
              </Button>
              {brandKitQuery.isLoading ? (
                <span className="text-xs text-muted-foreground">Loading…</span>
              ) : null}
            </div>
          </form>

          <Section
            variant="plain"
            title="Logos, mascots & references"
            description="Uploads stay private to this workspace."
            contentClassName="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {BRAND_ASSET_TYPES.map((type) => (
                <AssetUploader
                  key={type}
                  workspaceId={workspaceId}
                  userId={user?.id ?? null}
                  assetType={type}
                  onUploaded={() =>
                    queryClient.invalidateQueries({ queryKey: ["brand-assets", workspaceId] })
                  }
                />
              ))}
            </div>

            {brandAssets.length === 0 ? (
              <EmptyState
                compact
                icon={Palette}
                title="No brand assets yet"
                description="Uploaded logos, mascots and references appear here and stay private to this workspace."
              />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {brandAssets.map((asset: MediaAsset) => (
                  <li key={asset.id} className="cartel-panel rounded-lg p-2.5 sm:p-3">
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-border bg-background/40">
                      {urls[asset.storage_path] ? (
                        <img
                          src={urls[asset.storage_path]}
                          alt={`${asset.asset_type} asset`}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Loading…</span>
                      )}
                    </div>
                    <p className="mt-2 truncate text-[11px] uppercase tracking-wider text-muted-foreground">
                      {asset.asset_type.replace("_", " ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <StickyActionBar
            desktop="hidden"
            end={
              <Button
                type="submit"
                form="brand-kit-form"
                className="min-h-11"
                disabled={save.isPending || brandKitQuery.isLoading || !form.brand_name.trim()}
              >
                {save.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                {loaded ? "Save changes" : "Create Brand Kit"}
              </Button>
            }
            start={
              <span className="truncate text-xs text-muted-foreground">
                {brandKitQuery.isLoading
                  ? "Loading…"
                  : loaded
                    ? "Brand Kit active"
                    : "Not created yet"}
              </span>
            }
          />
        </>
      )}
    </div>
  );
}

