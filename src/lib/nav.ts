import {
  LayoutDashboard,
  IdCard,
  Rocket,
  Sticker,
  Palette,
  FolderLock,
  MessageSquare,
  Send,
  Globe,
  Eye,

  ShieldHalf,
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
      { label: "Project Profile", to: "/project-profile", icon: IdCard },
      {
        label: "Launch Control",
        to: "/launch-control",
        icon: Rocket,
        mobilePrimary: true,
        mobileLabel: "Launch",
      },
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
      { label: "Assets", to: "/assets", icon: FolderLock },
    ],
  },
  {
    label: "Community",
    items: [
      {
        label: "Community Command",
        to: "/telegram",
        icon: MessageSquare,
        mobilePrimary: true,
        mobileLabel: "Community",
      },
      { label: "Sticker Drops", to: "/distribution", icon: Send },
    ],
  },
  {
    label: "Network",
    items: [
      { label: "Cartel Network", to: "/network", icon: Globe },
      { label: "My Watchlist", to: "/watchlist", icon: Eye },
    ],
  },

  {
    label: "System",
    items: [
      { label: "Owner Console", to: "/admin", icon: ShieldHalf, ownerOnly: true },
    ],
  },
];

export const MOBILE_PRIMARY_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) =>
  section.items.filter((item) => item.mobilePrimary),
);
