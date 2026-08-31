import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FolderLock, Loader2, Palette, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";
import {
  listWorkspaceAssets,
  signedUrlMap,
  type AssetType,
  type MediaAsset,
} from "@/lib/media";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Section } from "@/components/cartel/Section";
import { StickyActionBar } from "@/components/cartel/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  MAX_CANONICAL_REFERENCES,
  emptyCharacterLock,
  formatLockList,
  parseLockList,
  readCharacterLock,
  writeCharacterLock,
  type CharacterLock,
} from "@/lib/brand-kit";

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

/** Character Lock form mirror — lists live as editable text here. */
type LockForm = {
  enabled: boolean;
  subjectName: string;
  identityNotes: string;
  protectedTraits: string;
  wardrobeAccessories: string;
  negativeConstraints: string;
  canonicalReferenceAssetIds: string[];
};

const EMPTY_LOCK_FORM: LockForm = {
  enabled: false,
  subjectName: "",
  identityNotes: "",
  protectedTraits: "",
  wardrobeAccessories: "",
  negativeConstraints: "",
  canonicalReferenceAssetIds: [],
};

const toLockForm = (lock: CharacterLock): LockForm => ({
  enabled: lock.enabled,
  subjectName: lock.subjectName,
  identityNotes: lock.identityNotes,
  protectedTraits: formatLockList(lock.protectedTraits),
  wardrobeAccessories: formatLockList(lock.wardrobeAccessories),
  negativeConstraints: formatLockList(lock.negativeConstraints),
  canonicalReferenceAssetIds: lock.canonicalReferenceAssetIds,
});

const fromLockForm = (form: LockForm): CharacterLock => ({
  enabled: form.enabled,
  subjectName: form.subjectName.trim(),
  identityNotes: form.identityNotes,
  protectedTraits: parseLockList(form.protectedTraits),
  wardrobeAccessories: parseLockList(form.wardrobeAccessories),
  negativeConstraints: parseLockList(form.negativeConstraints),
  canonicalReferenceAssetIds: form.canonicalReferenceAssetIds.slice(0, MAX_CANONICAL_REFERENCES),
});

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
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BrandKitForm>(EMPTY_FORM);
  const [lockForm, setLockForm] = useState<LockForm>(EMPTY_LOCK_FORM);

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
      setLockForm(EMPTY_LOCK_FORM);
      return;
    }
    setLockForm(toLockForm(readCharacterLock(loaded.metadata)));
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
      if (!workspaceId) throw new Error("No active project.");
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
        // Merge only our key; every other metadata key on the row is preserved.
        metadata: writeCharacterLock(
          loaded?.metadata ?? {},
          fromLockForm(lockForm),
        ) as never,
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
        description="Brand Kit holds this project's creative rules — identity, colour, type, links and AI style guidance. Actual files live in Asset Vault. Sticker Lab uses this Brand Kit when one is saved and can reuse Asset Vault references."
        status={workspace ? workspace.name : "No project"}
      />

      {!workspaceLoading && !workspaceId ? (
        <EmptyState
          icon={Palette}
          title="No project yet"
          description="Add a project from the selector in the header before setting up a Brand Kit."
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
              <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
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
              <div className="grid gap-4 md:grid-cols-3 [&>*]:min-w-0">
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
              <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
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
              <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
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
            variant="quiet"
            title="Project references"
            description="Read-only view of files stored in this project's Asset Vault. Files are managed once in Asset Vault. Brand Kit only shows related references here for context; Project Profile and Sticker Lab can reuse applicable files. There is no separate Brand Kit file copy."
            actions={
              <Button asChild variant="outline" size="sm" className="min-h-10">
                <Link to="/assets">
                  <FolderLock className="size-4" aria-hidden="true" />
                  Open Asset Vault
                </Link>
              </Button>
            }
            contentClassName="space-y-3"
          >
            {assetsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading project references…</p>
            ) : assetsQuery.isError ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-xs text-signal">
                  Project references could not be loaded, so this list is unavailable right now.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  onClick={() => void assetsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : brandAssets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No logos, mascots or reference images in Asset Vault yet.
              </p>
            ) : (
              <>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 [&>*]:min-w-0">
                  {brandAssets.slice(0, 6).map((asset: MediaAsset) => (
                    <li key={asset.id} className="rounded-md border border-border/70 p-1.5">
                      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-sm bg-background/40">
                        {urls[asset.storage_path] ? (
                          <img
                            src={urls[asset.storage_path]}
                            alt={`${asset.asset_type.replace("_", " ")} reference`}
                            className="max-h-full max-w-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Loading…</span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-[10px] uppercase tracking-wider text-muted-foreground">
                        {asset.asset_type.replace("_", " ")}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {brandAssets.length} logo, mascot and reference file
                  {brandAssets.length === 1 ? "" : "s"} in Asset Vault
                  {brandAssets.length > 6 ? " · showing the 6 most recent" : ""}.
                </p>
              </>
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

