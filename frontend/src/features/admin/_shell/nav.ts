import type { LucideIcon } from "lucide-react";
import {
  ArchiveRestore,
  AudioLines,
  Cable,
  FolderSearch,
  FolderTree,
  Key,
  LayoutDashboard,
  Radio,
  RadioTower,
  ScrollText,
  Send,
  Settings,
  Share2,
  Users,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
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
        icon: LayoutDashboard,
        keywords: "dashboard activity stats home",
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
    ],
  },
  {
    title: "Radio data",
    items: [
      {
        to: "/admin/systems",
        label: "Systems",
        icon: Radio,
        keywords: "talkgroups units blacklist",
      },
      {
        to: "/admin/groups",
        label: "Groups & tags",
        icon: FolderTree,
      },
      {
        to: "/admin/apikeys",
        label: "API keys",
        icon: Key,
        keywords: "upload recorder",
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
      {
        to: "/admin/shared-links",
        label: "Shared links",
        icon: Share2,
      },
      {
        to: "/admin/transcription",
        label: "Transcription",
        icon: AudioLines,
        keywords: "whisper models speech",
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
        to: "/admin/logs",
        label: "Logs & audit",
        icon: ScrollText,
      },
      {
        to: "/admin/trunk-recorder",
        label: "Trunk Recorder",
        icon: RadioTower,
        keywords: "mqtt instances recorders",
      },
      {
        to: "/admin/tools",
        label: "Backup & import",
        icon: ArchiveRestore,
        keywords: "tools export restore csv radioreference",
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
