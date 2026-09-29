import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listWorkspaces from "./tools/list-workspaces";
import getProjectProfile from "./tools/get-project-profile";
import listLaunches from "./tools/list-launches";

// Direct Supabase host is required as the OAuth issuer (not a proxy URL).
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "ocoinbnjgstkmnwwvnhi";

export default defineMcp({
  name: "cartel-command-center",
  title: "Cartel Command Center",
  version: "0.1.0",
  instructions:
    "Read-only access to CARTEL HQ as the signed-in user. Call list_workspaces first, then get_project_profile or list_launches with a workspace_id. Launch statuses are literal states, never audits, endorsements or safety guarantees.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listWorkspaces, getProjectProfile, listLaunches],
});
