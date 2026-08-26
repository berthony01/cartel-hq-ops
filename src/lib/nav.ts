import {
  LayoutDashboard,
  Sticker,
  Palette,
  FolderLock,
  Radio,
  Target,
  Users,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  status?: "next" | "planned";
};

export const NAV_ITEMS: NavItem[] = [
  { label: "HQ", to: "/", icon: LayoutDashboard },
  { label: "Sticker Lab", to: "/sticker-lab", icon: Sticker, status: "next" },
  { label: "Brand Kit", to: "/brand-kit", icon: Palette, status: "planned" },
  { label: "Assets", to: "/assets", icon: FolderLock, status: "planned" },
  { label: "Operations", to: "/operations", icon: Radio, status: "planned" },
  { label: "Missions", to: "/missions", icon: Target, status: "planned" },
  { label: "Operatives", to: "/operatives", icon: Users, status: "planned" },
  { label: "Analytics", to: "/analytics", icon: BarChart3, status: "planned" },
  { label: "Settings", to: "/settings", icon: Settings, status: "planned" },
];
