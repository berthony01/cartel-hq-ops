import { createFileRoute, Outlet } from "@tanstack/react-router";
import { NetworkShell } from "@/components/cartel-network/NetworkShell";

export const Route = createFileRoute("/network")({
  component: NetworkLayout,
});

function NetworkLayout() {
  return (
    <NetworkShell>
      <Outlet />
    </NetworkShell>
  );
}
