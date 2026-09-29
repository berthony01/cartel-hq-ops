import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, toolError } from "../supabase";

export default defineTool({
  name: "list_workspaces",
  title: "List workspaces",
  description: "List the CARTEL HQ workspaces the signed-in user belongs to, with their role.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    if (!ctx.isAuthenticated()) return toolError("Not authenticated");
    const { data, error } = await supabaseForUser(ctx)
      .from("workspace_members")
      .select("workspace_id,role")
      .eq("user_id", ctx.getUserId());
    if (error) return toolError(error.message);
    const workspaces = (data ?? []).map((r) => ({
      workspace_id: String(r.workspace_id),
      role: String(r.role ?? ""),
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(workspaces) }],
      structuredContent: { workspaces },
    };
  },
});
