import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/sticker-lab")({
  component: StickerLabLayout,
});

function StickerLabLayout() {
  return <Outlet />;
}
