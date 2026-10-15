import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleHelp, Loader2 } from "lucide-react";

import { useWorkspace } from "@/lib/workspace-context";
import { shouldResetHelp, type HelpTopic } from "@/lib/setup-help";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

// Content (docs bundle + setup queries) loads only when help is opened.
const SetupHelpPanel = lazy(() => import("@/components/cartel/SetupHelpPanel"));

type SetupHelpContextValue = { openHelp: (topic?: HelpTopic | null, trigger?: HTMLElement | null) => void };

const SetupHelpContext = createContext<SetupHelpContextValue | null>(null);

export function useSetupHelp(): SetupHelpContextValue {
  const ctx = useContext(SetupHelpContext);
  if (!ctx) throw new Error("useSetupHelp must be used inside SetupHelpProvider");
  return ctx;
}

export function SetupHelpProvider({ children }: { children: ReactNode }) {
  const { workspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const lastWorkspace = useRef(workspaceId);
  // Exact button that opened help; focus returns here on close (Escape or X).
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (shouldResetHelp(lastWorkspace.current, workspaceId)) {
      lastWorkspace.current = workspaceId;
      setOpen(false);
      setTopic(null);
      triggerRef.current = null;
    }
  }, [workspaceId]);

  const openHelp = useCallback((next?: HelpTopic | null, trigger?: HTMLElement | null) => {
    triggerRef.current = trigger ?? null;
    setTopic(next ?? null);
    setOpen(true);
  }, []);

  const value = useMemo(() => ({ openHelp }), [openHelp]);

  return (
    <SetupHelpContext.Provider value={value}>
      {children}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTopic(null);
        }}
      >
        <SheetContent side="right" className="safe-bottom w-[min(26rem,92vw)] overflow-y-auto sm:max-w-md"
          onCloseAutoFocus={(event) => {
            const trigger = triggerRef.current;
            triggerRef.current = null;
            if (trigger && trigger.isConnected) {
              event.preventDefault();
              trigger.focus({ preventScroll: true });
            }
          }}
        >
          <SheetTitle>Help &amp; AI Guide</SheetTitle>
          <SheetDescription className="text-xs">
            Setup Help uses your current progress and the Help Center. The AI Guide is a switched-off preview, not a live assistant.
          </SheetDescription>
          {open ? (
            <Suspense
              fallback={
                <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
                  Loading help…
                </p>
              }
            >
              <SetupHelpPanel key={workspaceId ?? "none"} topic={topic} onNavigate={() => setOpen(false)} />
            </Suspense>
          ) : null}
        </SheetContent>
      </Sheet>
    </SetupHelpContext.Provider>
  );
}

/** Header entry: labelled on all sizes; same shared help view for whatever page is open. */
export function SetupHelpHeaderButton() {
  const { openHelp } = useSetupHelp();
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-h-11 gap-1.5 border-gold/50 px-3 text-foreground hover:border-gold hover:bg-gold/10"
      aria-label="Help & AI Guide for this page"
      title="Help & AI Guide for this page"
      onClick={(e) => openHelp(null, e.currentTarget)}
    >
      <CircleHelp className="size-4 text-gold" aria-hidden="true" />
      <span className="sm:hidden">Help</span>
      <span className="hidden sm:inline">Help &amp; AI Guide</span>
    </Button>
  );
}
