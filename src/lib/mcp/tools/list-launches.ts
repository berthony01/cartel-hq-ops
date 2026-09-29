import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, toolError } from "../supabase";

export default defineTool({
  name: "list_launches",
  title: "List launches",
  description: "List launches and their lifecycle status for one workspace. Status is a literal state, not a safety claim.",
  inputSchema: { workspace_id: z.string().uuid().describe("Workspace ID from list_workspaces.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ workspace_id }, ctx) => {
    if (!ctx.isAuthenticated()) return toolError("Not authenticated");
    const { data, error } = await supabaseForUser(ctx)
      .from("launches")
      .select("id,token_name,status,launch_kind,announced_at,watchlist_opened_at,created_at")
      .eq("workspace_id", workspace_id)
      .order("created_at", { ascending: false });
    if (error) return toolError(error.message);
    const str = (v: unknown) => (v == null ? null : String(v));
    // Launch Watch token is deliberately never returned.
    const launches = (data ?? []).map((r) => ({
      id: String(r.id),
      token_name: str(r.token_name),
      status: str(r.status),
      launch_kind: str(r.launch_kind),
      announced_at: str(r.announced_at),
      watchlist_opened_at: str(r.watchlist_opened_at),
      created_at: str(r.created_at),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(launches) }],
      structuredContent: { launches },
    };
  },
});
