import {
  parseMissionSetupStartParam,
  validateTelegramInitData,
} from "../../../src/lib/telegram-miniapp-auth.server.ts";

export type SetupAutoSelectSnapshot = {
  observedAt: string;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
};

export type SetupAutoSelectDeps = {
  serviceRoleKey: string;
  botToken: string;
  authorizeReadySetup: (input: {
    candidateId: string;
    connectionId: string;
    closeToken: string | null;
    telegramUserId: number;
  }) => Promise<{ ok: true; externalPostId: string } | { ok: false; reason: string }>;
  readMetrics: (externalPostId: string) => Promise<SetupAutoSelectSnapshot | null>;
  suggestTargets: (snapshot: SetupAutoSelectSnapshot) => Promise<Record<string, unknown> | null>;
};

const INTERNAL_SOURCE = "telegram-miniapp-bridge";
const TARGET_KEYS = ["likes", "replies", "reposts", "bookmarks"] as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function boundedTargets(row: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(TARGET_KEYS.flatMap((key) => {
    const value = Number(row[key]);
    return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
      ? [[key, value]]
      : [];
  }));
}

export async function handleSetupAutoSelect(
  request: Request,
  deps: SetupAutoSelectDeps,
): Promise<Response> {
  if (request.method !== "POST") return json({ ok: false, reason: "method_not_allowed" }, 405);
  if (
    !deps.serviceRoleKey ||
    request.headers.get("Authorization") !== `Bearer ${deps.serviceRoleKey}` ||
    request.headers.get("X-Cartel-Internal-Source") !== INTERNAL_SOURCE
  ) {
    return json({ ok: false, reason: "unauthorized" }, 401);
  }

  let body: { action?: unknown; initData?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return json({ ok: false, reason: "invalid_request" }, 400);
  }
  if (body.action !== "auto_select") return json({ ok: false, reason: "invalid_action" }, 400);

  const auth = await validateTelegramInitData(body.initData, deps.botToken);
  if (!auth.ok) return json({ ok: false, reason: "unauthorized" }, 401);
  if (auth.startParam.state !== "valid") {
    return json({ ok: false, reason: "mission_setup_invalid" }, 403);
  }
  const route = parseMissionSetupStartParam(auth.startParam.value);
  if (!route) return json({ ok: false, reason: "mission_setup_invalid" }, 403);

  const setup = await deps.authorizeReadySetup({
    candidateId: route.candidateId,
    connectionId: route.connectionId,
    closeToken: route.closeToken,
    telegramUserId: auth.user.id,
  });
  if (!setup.ok) return json({ ok: false, reason: setup.reason }, 403);

  const snapshot = await deps.readMetrics(setup.externalPostId);
  if (!snapshot) {
    return json({
      ok: true,
      suggestion: {
        available: false,
        basis: "Official X metrics are unavailable right now. No values were invented.",
        observedAt: null,
        targets: {},
      },
    });
  }
  const suggested = await deps.suggestTargets(snapshot);
  if (!suggested) return json({ ok: false, reason: "unavailable" }, 503);
  const targets = boundedTargets(suggested);
  return json({
    ok: true,
    suggestion: {
      available: Object.keys(targets).length > 0,
      basis: "Suggested from one current official X snapshot using the existing mission target policy.",
      observedAt: snapshot.observedAt,
      targets,
    },
  });
}