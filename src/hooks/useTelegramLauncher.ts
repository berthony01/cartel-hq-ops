import { useCallback, useEffect, useRef } from "react";

/** Android / iPhone / iPod / iPad incl. modern iPadOS (Macintosh + touch). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

/**
 * Shared, platform-aware Telegram launcher.
 * Desktop: real https t.me URL in a new tab (never a blank pre-opened tab).
 * Mobile: `tg://` deep link first with a visibility/pagehide guarded https fallback.
 */
export function useTelegramLauncher() {
  const fallbackRef = useRef<number | null>(null);
  const handoffRef = useRef(false);
  const listenerCleanupRef = useRef<(() => void) | null>(null);

  const clearFallback = useCallback(() => {
    if (fallbackRef.current !== null) {
      window.clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  const clearListeners = useCallback(() => {
    if (listenerCleanupRef.current) {
      listenerCleanupRef.current();
      listenerCleanupRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearFallback();
    clearListeners();
  }, [clearFallback, clearListeners]);

  const launchTelegram = useCallback(
    (appUrl?: string, webUrl?: string): boolean => {
      const mobile = isMobileDevice();
      clearListeners();
      clearFallback();

      // Sandboxed preview iframes can throw SecurityError on window.open or on a
      // top-level navigation. Never let that escape into the React error boundary.
      const navigate = (url: string): boolean => {
        try {
          window.location.href = url;
          return true;
        } catch {
          return false;
        }
      };

      if (mobile && appUrl) {
        handoffRef.current = false;

        const onVisibility = () => {
          if (document.hidden) {
            handoffRef.current = true;
            clearFallback();
            clearListeners();
          }
        };
        const onPageHide = () => {
          handoffRef.current = true;
          clearFallback();
          clearListeners();
        };

        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", onPageHide);
        listenerCleanupRef.current = () => {
          document.removeEventListener("visibilitychange", onVisibility);
          window.removeEventListener("pagehide", onPageHide);
        };

        const started = navigate(appUrl);
        fallbackRef.current = window.setTimeout(() => {
          fallbackRef.current = null;
          clearListeners();
          if (!handoffRef.current && document.visibilityState === "visible" && webUrl) {
            navigate(webUrl);
          }
        }, 1300);
        if (started) return true;
        return webUrl ? navigate(webUrl) : false;
      }

      const url = webUrl ?? appUrl;
      if (!url) return false;
      if (mobile) return navigate(url);

      let opened: Window | null = null;
      try {
        opened = window.open(url, "_blank");
      } catch {
        opened = null;
      }
      if (opened) {
        try {
          opened.opener = null;
        } catch {
          /* noop — some browsers restrict cross-origin opener mutation */
        }
        return true;
      }
      return navigate(url);
    },
    [clearFallback, clearListeners],
  );


  return { launchTelegram, isMobileDevice };
}
