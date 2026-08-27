import { useEffect, useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

let currentSession: Session | null = null;
let initialized = false;
let initialization: Promise<void> | null = null;
let snapshot = { session: currentSession, initialized };
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function setAuthSession(session: Session | null) {
  currentSession = session;
  initialized = true;
  snapshot = { session: currentSession, initialized };
  emitChange();
}

function initializeSession() {
  if (initialized || initialization) return;

  initialization = supabase.auth.getSession().then(({ data }) => {
    setAuthSession(data.session);
  }).finally(() => {
    initialization = null;
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

const serverSnapshot = { session: null, initialized: false };

/**
 * Client-side session state. The single global auth listener lives in
 * `src/routes/__root.tsx`; this hook only mirrors the current session.
 */
export function useSession() {
  const state = useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);

  useEffect(() => {
    initializeSession();
  }, []);

  return {
    session: state.session,
    user: state.session?.user ?? null,
    loading: !state.initialized,
  };
}
