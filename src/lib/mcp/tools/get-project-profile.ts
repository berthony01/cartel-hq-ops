import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, toolError } from "../supabase";

export default defineTool({
  name: "get_project_profile",
  title: "Get project profile",
  description: "Read the Project Profile (name, ticker, chain, links, discovery status) for one workspace.",
  inputSchema: { workspace_id: z.string().uuid().describe("Workspace ID from list_workspaces.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ workspace_id }, ctx) => {
    if (!ctx.isAuthenticated()) return toolError("Not authenticated");
    const { data, error } = await supabaseForUser(ctx)
      .from("project_profiles")
      .select("*")
      .eq("workspace_id", workspace_id)
      .maybeSingle();
    if (error) return toolError(error.message);
    if (!data) return toolError("No Project Profile found for this workspace, or you do not have access.");
    const r = data as Record<string, unknown>;
    const s = (k: string) => (r[k] == null ? null : String(r[k]));
    const profile = {
      id: s("id"),
      slug: s("slug"),
      project_name: s("project_name"),
      ticker: s("ticker"),
      chain: s("chain"),
      description: s("description"),
      website_url: s("website_url"),
      telegram_url: s("telegram_url"),
      x_url: s("x_url"),
      discovery_status: s("discovery_status"),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(profile) }],
      structuredContent: { profile },
    };
  },
});
