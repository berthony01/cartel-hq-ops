import {
  LayoutDashboard,
  ShieldCheck,
  TerminalSquare,
  Sticker,
  Palette,
  FolderLock,
  Radio,
  Target,
  Users,
  Send,
  Radar,
  Award,
  BarChart3,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  to: string;
  icon: LucideIcon;
  status?: "next" | "planned";
  /** Presentation only: surfaced as a primary destination in the mobile tab bar. */
  mobilePrimary?: boolean;
  /** Presentation only: shorter label used in the mobile tab bar. */
  mobileLabel?: string;
  /**
   * Presentation only: hidden unless the server confirms platform ownership.
   * Hiding is NOT the security boundary — the route and Edge Function enforce.
   */
  ownerOnly?: boolean;
};



export type NavSection = {
  label: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Command",
    items: [
      { label: "HQ", to: "/", icon: LayoutDashboard, mobilePrimary: true },
      { label: "Cartel Clearance", to: "/clearance", icon: ShieldCheck, status: "planned" },
      { label: "Command Terminal", to: "/command-terminal", icon: TerminalSquare, status: "planned" },
    ],
  },
  {
    label: "Create",
    items: [
      {
        label: "Sticker Lab",
        to: "/sticker-lab",
        icon: Sticker,
        mobilePrimary: true,
        mobileLabel: "Lab",
      },
      { label: "Brand Kit", to: "/brand-kit", icon: Palette },
      { label: "Assets", to: "/assets", icon: FolderLock, mobilePrimary: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Operations", to: "/operations", icon: Radio, status: "planned" },
      { label: "Missions", to: "/missions", icon: Target, status: "planned" },
      { label: "Operatives", to: "/operatives", icon: Users, status: "planned" },
      { label: "Distribution", to: "/distribution", icon: Send },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "Cartel Shield", to: "/cartel-shield", icon: Radar, status: "planned" },
      { label: "Reputation", to: "/reputation", icon: Award, status: "planned" },
      { label: "Analytics", to: "/analytics", icon: BarChart3, status: "planned" },
    ],
  },
  {
    label: "System",
    items: [
      {
        label: "Telegram",
        to: "/telegram",
        icon: MessageSquare,
        mobilePrimary: true,
      },
      { label: "Settings", to: "/settings", icon: Settings },
    ],
  },
];

export const MOBILE_PRIMARY_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) =>
  section.items.filter((item) => item.mobilePrimary),
);
