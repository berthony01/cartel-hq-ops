import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ACCEPTED_IMAGE_TYPES,
  ASSET_TYPE_LABELS,
  uploadWorkspaceAsset,
  validateImageFile,
  type AssetType,
  type MediaAsset,
} from "@/lib/media";

export function AssetUploader({
  workspaceId,
  userId,
  assetType,
  label,
  onUploaded,
  disabled,
}: {
  workspaceId: string | null;
  userId: string | null;
  assetType: AssetType;
  label?: string;
  onUploaded?: (asset: MediaAsset) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = disabled || !workspaceId || !userId;

  const handleFile = async (file: File | undefined | null) => {
    if (!file || !workspaceId || !userId) return;
    const invalid = validateImageFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const asset = await uploadWorkspaceAsset({ workspaceId, userId, file, assetType });
      toast.success(`${ASSET_TYPE_LABELS[assetType]} uploaded`);
      onUploaded?.(asset);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          if (blocked) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (blocked) return;
          e.preventDefault();
          setDragging(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center transition-colors ${
          dragging ? "border-gold bg-gold/5" : "border-border bg-background/40"
        }`}
      >
        <span className="flex size-10 items-center justify-center rounded-md border border-border bg-surface-raised text-gold">
          {busy ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus className="size-5" aria-hidden="true" />
          )}
        </span>
        <p className="text-sm font-medium text-foreground">
          {label ?? `Upload ${ASSET_TYPE_LABELS[assetType].toLowerCase()}`}
        </p>
        <p className="text-xs text-muted-foreground">Images only · up to 25MB · private storage</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={blocked || busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Uploading…" : "Choose file"}
        </Button>
        {!workspaceId ? (
          <p className="text-xs text-muted-foreground">Create a workspace first.</p>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        className="sr-only"
        aria-label={label ?? `Upload ${ASSET_TYPE_LABELS[assetType]}`}
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />
      {error ? (
        <p role="alert" className="mt-2 text-xs text-signal">
          {error}
        </p>
      ) : null}
    </div>
  );
}
