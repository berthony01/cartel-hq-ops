import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  Info,
  Plus,
  RotateCcw,
  Send,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  BUILDER_STEPS,
  PACK_SIZES,
  PACK_THEMES,
  loadDraft,
  saveDraft,
  starterConcepts,
  type BuilderDraft,
  type Concept,
  type PackSize,
  type PackTheme,
} from "@/lib/sticker-lab";

export const Route = createFileRoute("/_authenticated/sticker-lab/new")({
  head: () => ({
    meta: [
      { title: "New Sticker Pack — Sticker Lab — CARTEL HQ" },
      {
        name: "description",
        content:
          "Prototype builder for planning a PEPECARTEL sticker pack: reference, setup, concepts, generation preview and Telegram review.",
      },
      { property: "og:title", content: "New Sticker Pack — CARTEL HQ" },
      {
        property: "og:description",
        content: "Walk through the planned PEPECARTEL sticker pack creation flow.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StickerLabBuilder,
});

const ACCEPTED = "image/png,image/jpeg,image/webp,image/gif";

function StickerLabBuilder() {
  const { workspaceId } = useWorkspace();
  const { user } = useSession();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [packNameError, setPackNameError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(loadDraft());
  }, []);

  useEffect(() => {
    if (draft) saveDraft(draft);
  }, [draft]);

  // Restore a preview for a reference already stored in the private bucket.
  const storedPath = draft?.referenceStoragePath ?? null;
  useEffect(() => {
    let active = true;
    if (!storedPath) return;
    signedUrl(storedPath, 3600).then((url) => {
      if (active && url) setPreviewUrl(url);
    });
    return () => {
      active = false;
    };
  }, [storedPath]);

  if (!draft) {
    return (
      <div className="py-24 text-center text-sm text-muted-foreground">Loading builder…</div>
    );
  }

  const update = (patch: Partial<BuilderDraft>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const applyFile = async (file: File | undefined | null) => {
    if (!file) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      setFileError(invalid);
      return;
    }
    if (!workspaceId || !user) {
      setFileError("Select or create a workspace before uploading a reference.");
      return;
    }
    setFileError(null);
    setUploading(true);
    try {
      const asset = await uploadWorkspaceAsset({
        workspaceId,
        userId: user.id,
        file,
        assetType: "reference_image",
      });
      const url = await signedUrl(asset.storage_path, 3600);
      setPreviewUrl(url);
      update({
        imageName: file.name,
        referenceAssetId: asset.id,
        referenceStoragePath: asset.storage_path,
      });
      toast.success("Reference image stored");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setFileError(message);
      toast.error(message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const clearFile = () => {
    setPreviewUrl(null);
    update({ imageName: null, referenceAssetId: null, referenceStoragePath: null });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };


  const setTheme = (theme: PackTheme) =>
    update({ theme, concepts: starterConcepts(theme, draft.size) });

  const setSize = (size: PackSize) => {
    const next =
      size <= draft.concepts.length
        ? draft.concepts.slice(0, size)
        : [
            ...draft.concepts,
            ...starterConcepts(draft.theme, size).slice(draft.concepts.length),
          ];
    update({ size, concepts: next });
  };

  const editConcept = (id: string, patch: Partial<Concept>) =>
    update({
      concepts: draft.concepts.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });

  const removeConcept = (id: string) =>
    update({ concepts: draft.concepts.filter((c) => c.id !== id) });

  const addConcept = () => {
    if (draft.concepts.length >= draft.size) return;
    update({
      concepts: [
        ...draft.concepts,
        {
          id: `c${Date.now()}`,
          label: "NEW CONCEPT",
          action: "describe the pose or expression",
          emoji: "⭐",
        },
      ],
    });
  };

  const goNext = () => {
    if (step === 2 && !draft.packName.trim()) {
      setPackNameError("Give the pack a name before continuing.");
      return;
    }
    setPackNameError(null);
    setStep((s) => Math.min(BUILDER_STEPS.length, s + 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goBack = () => {
    setStep((s) => Math.max(1, s - 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Sticker Lab"
        title="New Sticker Pack"
        description="A frontend prototype of the pack creation flow. Nothing here uploads, generates or publishes — your inputs stay in this browser session only."
        status="Prototype · Not connected"
        actions={
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/sticker-lab">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Sticker Lab
            </Link>
          </Button>
        }
      />

      <Stepper current={step} onSelect={setStep} />

      {step === 1 ? (
        <StepCard
          title="Character Reference"
          hint="Preview only in this phase. Nothing is uploaded or stored."
        >
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <span className="mb-2 block text-sm font-medium text-foreground">
                Reference image
              </span>
              {previewUrl ? (
                <div className="cartel-panel flex flex-col items-center gap-3 rounded-lg p-4">
                  <img
                    src={previewUrl}
                    alt={`Local preview of ${draft.imageName ?? "reference image"}`}
                    className="max-h-56 w-auto rounded-md border border-border object-contain"
                  />
                  <p className="w-full truncate text-center text-xs text-muted-foreground">
                    {draft.imageName}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-10"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Change image
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-10 text-signal hover:text-signal"
                      onClick={clearFile}
                    >
                      <X className="size-4" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    applyFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-8 text-center transition-colors ${
                    dragging ? "border-gold bg-gold/5" : "border-border bg-background/40"
                  }`}
                >
                  <span className="flex size-11 items-center justify-center rounded-md border border-border bg-surface-raised text-gold">
                    <ImagePlus className="size-5" aria-hidden="true" />
                  </span>
                  <p className="text-sm font-medium text-foreground">
                    Drag an image here, or choose a file
                  </p>
                  <p className="text-xs text-muted-foreground">PNG, JPG, WEBP or GIF</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Choose file
                  </Button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED}
                className="sr-only"
                aria-label="Choose a character reference image"
                onChange={(e) => applyFile(e.target.files?.[0])}
              />
              {fileError ? (
                <p role="alert" className="mt-2 text-xs text-signal">
                  {fileError}
                </p>
              ) : null}
            </div>

            <div className="space-y-5">
              <div>
                <Label htmlFor="character-name">Character or brand name (optional)</Label>
                <Input
                  id="character-name"
                  className="mt-2 min-h-11"
                  placeholder="e.g. Pepe Capo"
                  value={draft.characterName}
                  aria-describedby="character-name-help"
                  onChange={(e) => update({ characterName: e.target.value })}
                />
                <p id="character-name-help" className="mt-2 text-xs text-muted-foreground">
                  Used later to keep the character consistent across every sticker.
                </p>
              </div>
              <Notice tone="muted">
                Images stay in your browser via a local object URL. There is no upload endpoint,
                bucket or database in this phase.
              </Notice>
            </div>
          </div>
        </StepCard>
      ) : null}

      {step === 2 ? (
        <StepCard title="Pack Setup" hint="Defines the brief the generator will eventually use.">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <Label htmlFor="pack-name">Pack name</Label>
              <Input
                id="pack-name"
                className="mt-2 min-h-11"
                placeholder="e.g. PEPECARTEL Reactions Vol. 1"
                value={draft.packName}
                aria-invalid={packNameError ? true : undefined}
                aria-describedby={packNameError ? "pack-name-error" : undefined}
                onChange={(e) => {
                  update({ packName: e.target.value });
                  if (e.target.value.trim()) setPackNameError(null);
                }}
              />
              {packNameError ? (
                <p id="pack-name-error" role="alert" className="mt-2 text-xs text-signal">
                  {packNameError}
                </p>
              ) : null}
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-foreground">Pack size</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PACK_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={draft.size === s}
                    onClick={() => setSize(s)}
                    className={`min-h-11 rounded-md border px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      draft.size === s
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border bg-surface-raised text-muted-foreground hover:border-gold/40"
                    }`}
                  >
                    {s} stickers
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="md:col-span-2">
              <legend className="text-sm font-medium text-foreground">Theme</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {PACK_THEMES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={draft.theme === t}
                    onClick={() => setTheme(t)}
                    className={`min-h-11 rounded-md border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      draft.theme === t
                        ? "border-gold bg-gold/10 text-gold"
                        : "border-border bg-surface-raised text-muted-foreground hover:border-gold/40"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Changing the theme replaces the starter concept suggestions in the next step.
              </p>
            </fieldset>

            <div>
              <Label htmlFor="brief">Custom brief</Label>
              <Textarea
                id="brief"
                className="mt-2 min-h-28"
                placeholder="What should this pack communicate? Tone, audience, running jokes…"
                value={draft.brief}
                onChange={(e) => update({ brief: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="style-notes">Visual style notes (optional)</Label>
              <Textarea
                id="style-notes"
                className="mt-2 min-h-28"
                placeholder="Line weight, palette, outline, shading, background treatment…"
                value={draft.styleNotes}
                onChange={(e) => update({ styleNotes: e.target.value })}
              />
            </div>
          </div>
        </StepCard>
      ) : null}

      {step === 3 ? (
        <StepCard
          title="Sticker Concepts"
          hint="Suggested examples generated locally from a fixed list — not AI output."
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10"
                onClick={() => update({ concepts: starterConcepts(draft.theme, draft.size) })}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset suggestions
              </Button>
              <Button
                type="button"
                size="sm"
                className="min-h-10"
                disabled={draft.concepts.length >= draft.size}
                onClick={addConcept}
              >
                <Plus className="size-4" aria-hidden="true" />
                Add concept
              </Button>
            </div>
          }
        >
          <p className="mb-4 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {draft.concepts.length} of {draft.size}
            </span>{" "}
            concepts used for this pack size.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {draft.concepts.map((c, i) => (
              <li key={c.id} className="cartel-panel rounded-lg p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-9 text-muted-foreground hover:text-signal"
                    onClick={() => removeConcept(c.id)}
                    aria-label={`Remove concept ${i + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor={`${c.id}-label`} className="text-xs">
                      Label
                    </Label>
                    <Input
                      id={`${c.id}-label`}
                      className="mt-1.5 min-h-10"
                      value={c.label}
                      onChange={(e) => editConcept(c.id, { label: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${c.id}-action`} className="text-xs">
                      Action / expression
                    </Label>
                    <Input
                      id={`${c.id}-action`}
                      className="mt-1.5 min-h-10"
                      value={c.action}
                      onChange={(e) => editConcept(c.id, { action: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${c.id}-emoji`} className="text-xs">
                      Emoji
                    </Label>
                    <Input
                      id={`${c.id}-emoji`}
                      className="mt-1.5 min-h-10 w-24"
                      value={c.emoji}
                      onChange={(e) => editConcept(c.id, { emoji: e.target.value })}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </StepCard>
      ) : null}

      {step === 4 ? (
        <StepCard title="Generation Preview" hint="Preflight only. No generation runs.">
          <Preflight draft={draft} hasImage={Boolean(draft.imageName)} />
          <Pipeline />
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {draft.concepts.map((c) => (
              <li
                key={c.id}
                className="cartel-panel flex aspect-square flex-col items-center justify-center gap-2 rounded-lg p-3 text-center"
              >
                <span className="text-2xl" aria-hidden="true">
                  {c.emoji}
                </span>
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                  {c.label}
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  AI generation not connected yet
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-6">
            <Button type="button" disabled className="min-h-11 w-full sm:w-auto">
              Generation API coming next
            </Button>
          </div>
        </StepCard>
      ) : null}

      {step === 5 ? (
        <StepCard
          title="Review & Telegram Preview"
          hint="Layout preview of the future review and publish step."
        >
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {draft.concepts.map((c) => (
              <li key={c.id} className="cartel-panel rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-12 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-background/40 text-xl"
                    aria-hidden="true"
                  >
                    {c.emoji}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{c.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Sticker image pending generation
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-[5rem_1fr] gap-2">
                  <div>
                    <Label htmlFor={`${c.id}-review-emoji`} className="text-xs">
                      Emoji
                    </Label>
                    <Input
                      id={`${c.id}-review-emoji`}
                      className="mt-1.5 min-h-10"
                      value={c.emoji}
                      onChange={(e) => editConcept(c.id, { emoji: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${c.id}-keywords`} className="text-xs">
                      Keywords
                    </Label>
                    <Input
                      id={`${c.id}-keywords`}
                      className="mt-1.5 min-h-10"
                      placeholder="comma, separated"
                      value={draft.keywords[c.id] ?? ""}
                      onChange={(e) =>
                        update({ keywords: { ...draft.keywords, [c.id]: e.target.value } })
                      }
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <Card className="cartel-panel mt-6">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle className="text-base">Telegram publish summary</CardTitle>
              <StatusBadge tone="muted">Not connected</StatusBadge>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <SummaryRow label="Pack name" value={draft.packName || "Not set"} />
                <SummaryRow label="Stickers" value={`${draft.concepts.length}`} />
                <SummaryRow
                  label="Emoji assigned"
                  value={`${draft.concepts.filter((c) => c.emoji.trim()).length} of ${draft.concepts.length}`}
                />
                <SummaryRow label="Short name" value="Reserved at publish time" />
              </dl>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Requirements for a future publish
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                  <li>Transparent PNG per sticker at Telegram's required dimensions</li>
                  <li>One emoji minimum per sticker</li>
                  <li>An authorised CARTEL HQ Telegram connection</li>
                </ul>
              </div>
              <Button type="button" disabled className="min-h-11 w-full sm:w-auto">
                <Send className="size-4" aria-hidden="true" />
                Connect Telegram in a later phase
              </Button>
            </CardContent>
          </Card>
        </StepCard>
      ) : null}

      <nav
        aria-label="Builder navigation"
        className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={goBack}
          disabled={step === 1}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Step {step} of {BUILDER_STEPS.length} · {BUILDER_STEPS[step - 1]!.title}
        </p>
        {step < BUILDER_STEPS.length ? (
          <Button type="button" className="min-h-11" onClick={goNext}>
            Next
            <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/sticker-lab">Back to Sticker Lab</Link>
          </Button>
        )}
      </nav>
    </div>
  );
}

function Stepper({
  current,
  onSelect,
}: {
  current: number;
  onSelect: (n: number) => void;
}) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Builder steps">
      {BUILDER_STEPS.map((s) => {
        const state = s.id === current ? "current" : s.id < current ? "done" : "todo";
        return (
          <li key={s.id} className="min-w-0 flex-1 basis-[8rem]">
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={state === "current" ? "step" : undefined}
              className={`flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                state === "current"
                  ? "border-gold bg-gold/10 text-gold"
                  : state === "done"
                    ? "border-pepe/40 bg-surface-raised text-pepe"
                    : "border-border bg-surface-raised text-muted-foreground hover:border-gold/40"
              }`}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold">
                {state === "done" ? <Check className="size-3" aria-hidden="true" /> : s.id}
              </span>
              <span className="truncate font-semibold uppercase tracking-[0.12em]">
                <span className="sm:hidden">{s.short}</span>
                <span className="hidden sm:inline">{s.title}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepCard({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="cartel-panel rise-in">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div>
          <CardTitle className="text-lg">{title}</CardTitle>
          <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Notice({ tone, children }: { tone: "muted" | "warn"; children: React.ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlert : Info;
  return (
    <p
      className={`flex gap-2 rounded-md border p-3 text-xs leading-relaxed ${
        tone === "warn"
          ? "border-signal/40 bg-signal/5 text-signal"
          : "border-border bg-background/40 text-muted-foreground"
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Preflight({ draft, hasImage }: { draft: BuilderDraft; hasImage: boolean }) {
  const rows = useMemo(
    () => [
      {
        label: "Reference image",
        value: hasImage ? (draft.imageName ?? "Present") : "Not provided",
        ok: hasImage,
      },
      { label: "Pack name", value: draft.packName || "Not set", ok: Boolean(draft.packName) },
      { label: "Theme", value: draft.theme, ok: true },
      { label: "Concepts", value: `${draft.concepts.length} of ${draft.size}`, ok: true },
      {
        label: "Style notes",
        value: draft.styleNotes ? "Provided" : "None",
        ok: Boolean(draft.styleNotes),
      },
    ],
    [draft, hasImage],
  );

  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => (
        <div key={r.label} className="cartel-panel rounded-lg p-3">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {r.label}
          </dt>
          <dd
            className={`mt-1 truncate text-sm font-medium ${r.ok ? "text-pepe" : "text-muted-foreground"}`}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Pipeline() {
  const stages = ["Generate", "Background Removal", "Transparency Check", "Review"];
  return (
    <ol className="mt-6 flex flex-wrap items-center gap-2" aria-label="Planned pipeline">
      {stages.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className="rounded-md border border-dashed border-border bg-background/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {s}
          </span>
          {i < stages.length - 1 ? (
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
