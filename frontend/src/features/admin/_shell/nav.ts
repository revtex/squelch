import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Cable,
  Folder,
  FolderSearch,
  Key,
  Mic,
  Radio,
  RadioTower,
  ScrollText,
  Send,
  Settings,
  Share2,
  Users,
  Wrench,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  /** The phone bar's label, where the full one is too long. */
  short?: string;
  icon: LucideIcon;
  /** Words the command palette also matches on. */
  keywords?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** The admin's sections, in sidebar order. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        to: "/admin/overview",
        label: "Overview",
        icon: Activity,
        keywords: "dashboard activity stats home",
      },
      {
        to: "/admin/trunk-recorder",
        label: "Trunk Recorder",
        icon: RadioTower,
        keywords: "mqtt instances recorders",
      },
      {
        to: "/admin/logs",
        label: "Logs & audit",
        short: "Logs",
        icon: ScrollText,
      },
    ],
  },
  {
    title: "People & access",
    items: [
      {
        to: "/admin/users",
        label: "Users",
        icon: Users,
        keywords: "accounts admins listeners passwords",
      },
      {
        to: "/admin/connections",
        label: "Connections",
        icon: Cable,
        keywords: "sessions devices history blocked addresses",
      },
      {
        to: "/admin/apikeys",
        label: "API keys",
        icon: Key,
        keywords: "upload recorder",
      },
      {
        to: "/admin/shared-links",
        label: "Shared links",
        icon: Share2,
      },
    ],
  },
  {
    title: "Radio data",
    items: [
      {
        to: "/admin/systems",
        label: "Systems & talkgroups",
        short: "Systems",
        icon: Radio,
        keywords: "talkgroups units blacklist",
      },
      {
        to: "/admin/groups",
        label: "Groups & tags",
        icon: Folder,
      },
      {
        to: "/admin/transcription",
        label: "Transcription",
        icon: Mic,
        keywords: "whisper models speech",
      },
    ],
  },
  {
    title: "Ingest & delivery",
    items: [
      {
        to: "/admin/dirmonitors",
        label: "Folder monitors",
        icon: FolderSearch,
        keywords: "directory watch ingest dirmonitor recorder files",
      },
      {
        to: "/admin/forwarding",
        label: "Forwarding",
        icon: Send,
        keywords: "downstreams webhooks discord forward notify",
      },
    ],
  },
  {
    title: "Server",
    items: [
      {
        to: "/admin/settings",
        label: "Settings",
        icon: Settings,
        keywords: "options config preferences branding email prune storage lockout log level audio conversion",
      },
      {
        to: "/admin/tools",
        label: "Backup & import",
        icon: Wrench,
        keywords: "tools export restore backup csv radioreference import",
      },
    ],
  },
];

export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** The phone's bottom bar: four sections and More. */
export const DOCK_ITEMS: readonly NavItem[] = [
  "/admin/overview",
  "/admin/users",
  "/admin/systems",
  "/admin/logs",
].map((to) => NAV_ITEMS.find((i) => i.to === to)!);
