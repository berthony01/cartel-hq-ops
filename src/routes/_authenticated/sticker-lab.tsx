import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/sticker-lab")({
  component: StickerLabLayout,
});

function StickerLabLayout() {
  return <Outlet />;
}
