import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  NavLink,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { Home, LogOut, Menu, Search } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/app/store";
import {
  selectToken,
  selectRole,
  selectUsername,
  clearCredentials,
  usePostLogoutMutation,
} from "@/features/auth";
import {
  CommandPalette,
  DOCK_ITEMS,
  NAV_GROUPS,
  NAV_ITEMS,
  NavigationGuardProvider,
  ToastProvider,
  useAdminWebSocket,
  useAdminWsStatus,
  useNavigationGuard,
  type NavItem,
} from "@/features/admin/_shell";
import UsersPanel from "@/features/admin/users";
import ConnectionsPanel from "@/features/admin/connections";
import SystemsPanel from "@/features/admin/systems";
import GroupsTagsPanel from "@/features/admin/groups-tags";
import ApiKeysPanel from "@/features/admin/api-keys";
import DirMonitorPanel from "@/features/admin/dir-monitor";
import ForwardingPanel from "@/features/admin/forwarding";
import SettingsPanel from "@/features/admin/settings";
import LogsPanel from "@/features/admin/logs";
import ToolsPanel from "@/features/admin/tools";
import DashboardsPanel, { ActivityPanel } from "@/features/admin/dashboards";
import { TrunkRecorderPanel } from "@/features/admin/trunk-recorder";
import SharedLinksPanel from "@/features/admin/shared-links";
import TranscriptionPanel from "@/features/admin/transcription";
import LegacyUsageBanner from "@/features/admin/legacy-usage";

/** Follows a nav link unless the page has unsaved changes. */
function useGuardedNavigate() {
  const { requestNavigation } = useNavigationGuard();
  const navigate = useNavigate();
  return useCallback(
    (to: string, after?: () => void) => (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (requestNavigation(to)) {
        navigate(to);
        after?.();
      }
    },
    [navigate, requestNavigation],
  );
}

// One look for every navigation row: the sidebar, its footer and the More
// sheet. The current page gets the navy fill and a gold bar on the left.
const NAV_ROW =
  "relative flex min-h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-base-content-dim hover:bg-base-300 hover:text-base-content aria-[current=page]:bg-admin-navy2 aria-[current=page]:text-base-content aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-2 aria-[current=page]:before:left-0 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-sm aria-[current=page]:before:bg-secondary aria-[current=page]:before:content-['']";
// Between md and lg the sidebar is a 76 px rail: icon over a small label.
const NAV_ROW_RAIL =
  "max-lg:min-h-[50px] max-lg:flex-col max-lg:justify-center max-lg:gap-[3px] max-lg:px-0.5 max-lg:pb-[5px] max-lg:pt-[7px] max-lg:text-center max-lg:text-[10px] max-lg:leading-[1.1] max-lg:aria-[current=page]:before:inset-y-1.5";
const GROUP_TITLE =
  "px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-admin-dim2";

function useHostname(): string {
  return typeof window === "undefined" ? "" : window.location.hostname;
}

function NavGroups({
  go,
  rail = false,
}: {
  go: (to: string) => (e: MouseEvent<HTMLAnchorElement>) => void;
  rail?: boolean;
}) {
  return (
    <>
      {NAV_GROUPS.map((g) => (
        <div
          key={g.title}
          className={`flex flex-col gap-0.5 ${
            rail
              ? "max-lg:border-t max-lg:border-admin-line max-lg:pt-1.5 max-lg:first:border-t-0 max-lg:first:pt-0"
              : ""
          }`}
        >
          <h2 className={`${GROUP_TITLE} ${rail ? "max-lg:sr-only" : ""}`}>
            {g.title}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={go(item.to)}
                  className={`${NAV_ROW} ${rail ? NAV_ROW_RAIL : ""}`}
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  <span className="min-w-0">
                    {rail ? (
                      <>
                        <span className="lg:hidden">{item.short ?? item.label}</span>
                        <span className="max-lg:hidden">{item.label}</span>
                      </>
                    ) : (
                      item.label
                    )}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function AccountRows({
  username,
  go,
  onSignOut,
  rail = false,
}: {
  username: string | null;
  go: (to: string) => (e: MouseEvent<HTMLAnchorElement>) => void;
  onSignOut: () => void;
  rail?: boolean;
}) {
  const row = `${NAV_ROW} ${rail ? NAV_ROW_RAIL : ""} text-xs`;
  return (
    <>
      <NavLink to="/" end onClick={go("/")} className={row}>
        <Home className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        Open scanner
      </NavLink>
      <button type="button" onClick={onSignOut} className={row}>
        <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        Sign out
        {username && (
          <span className={`ml-auto truncate ${rail ? "max-lg:hidden" : ""}`}>
            {username}
          </span>
        )}
      </button>
    </>
  );
}

function Sidebar({
  username,
  onSignOut,
}: {
  username: string | null;
  onSignOut: () => void;
}) {
  const go = useGuardedNavigate();
  const host = useHostname();
  return (
    <aside className="sticky top-0 hidden h-screen w-19 shrink-0 flex-col gap-1.5 overflow-y-auto overflow-x-hidden border-r border-admin-line bg-base-200 px-1.5 py-2.5 [scrollbar-width:thin] md:flex lg:w-58 lg:gap-2 lg:px-2.5 lg:py-3">
      <div className="flex items-center gap-2.5 px-2 pb-0.5 pt-1 max-lg:justify-center max-lg:px-0 max-lg:pb-1.5 max-lg:pt-0.5">
        <span
          aria-hidden="true"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary font-mono font-semibold text-secondary"
        >
          SQ
        </span>
        <div className="min-w-0 max-lg:sr-only">
          <b className="block text-[15px] font-semibold">Squelch</b>
          <span className="block truncate text-[11px] text-base-content-dim">
            Admin{host ? ` · ${host}` : ""}
          </span>
        </div>
      </div>
      <nav
        aria-label="Admin sections"
        className="flex flex-col gap-2 max-lg:gap-1.5"
      >
        <NavGroups go={go} rail />
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 border-t border-admin-line pt-2.5 max-lg:pt-1.5">
        <AccountRows username={username} go={go} onSignOut={onSignOut} rail />
      </div>
    </aside>
  );
}

const STATUS_LABEL = {
  connected: "Live · admin socket connected",
  connecting: "Reconnecting…",
  offline: "Offline",
} as const;
const STATUS_DOT = {
  connected: "bg-admin-live shadow-[0_0_0_3px_color-mix(in_oklab,var(--admin-live)_18%,transparent)]",
  connecting: "bg-admin-paused",
  offline: "bg-error",
} as const;

function SocketStatus() {
  const status = useAdminWsStatus();
  return (
    <div
      role="status"
      className="ml-auto flex items-center gap-2 whitespace-nowrap text-xs text-base-content-dim"
      title="The admin's live connection to the server"
    >
      <span
        className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
        aria-hidden="true"
      />
      <span className="max-md:sr-only">{STATUS_LABEL[status]}</span>
    </div>
  );
}

function TopBar({
  onSearch,
  onMenu,
}: {
  onSearch: () => void;
  onMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center gap-3 border-b border-admin-line bg-base-100 px-3 py-2 md:px-5 md:py-2.5">
      <button
        type="button"
        className="btn btn-square md:hidden"
        aria-label="Open menu"
        onClick={onMenu}
      >
        <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="flex min-h-10 min-w-0 max-w-[440px] flex-1 cursor-text items-center gap-2 rounded-md border border-admin-line bg-base-200 pl-[11px] pr-2 text-left text-base-content-dim"
        onClick={onSearch}
        aria-keyshortcuts="Control+K"
      >
        <Search className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          Search users, talkgroups, settings…
        </span>
        <kbd className="kbd max-md:hidden" aria-hidden="true">
          Ctrl K
        </kbd>
      </button>
      <SocketStatus />
    </header>
  );
}

const DOCK_ROW =
  "flex min-h-14 flex-1 cursor-pointer flex-col items-center gap-[3px] px-1 pb-1.5 pt-2 text-[11px] text-base-content-dim";

function Dock({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const go = useGuardedNavigate();
  const location = useLocation();
  const inDock = DOCK_ITEMS.some((i) => location.pathname.startsWith(i.to));
  return (
    <nav
      aria-label="Admin sections"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-admin-line bg-base-200 pb-[env(safe-area-inset-bottom,0px)] md:hidden"
    >
      {DOCK_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={go(item.to)}
          className={`${DOCK_ROW} aria-[current=page]:text-secondary`}
        >
          <item.icon className="h-5 w-5" aria-hidden="true" />
          {item.short ?? item.label}
        </NavLink>
      ))}
      <button
        type="button"
        className={`${DOCK_ROW} ${moreOpen || !inDock ? "text-secondary" : ""}`}
        aria-expanded={moreOpen}
        onClick={onMore}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        More
      </button>
    </nav>
  );
}

/** Every section, as a sheet from the bottom: the phone's whole sidebar. */
function MoreSheet({
  username,
  onClose,
  onSignOut,
}: {
  username: string | null;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const go = useGuardedNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.querySelector<HTMLElement>("a,button")?.focus();
  }, []);
  const goAndClose = (to: string) => go(to, onClose);
  return (
    <dialog
      open
      className="modal modal-open modal-bottom"
      aria-label="All sections"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div
        ref={boxRef}
        className="modal-box flex max-h-[80vh] flex-col gap-2 rounded-t-2xl border-x-0 border-b-0 px-3 pb-[calc(16px+env(safe-area-inset-bottom,0px))] pt-3 shadow-none"
      >
        <div className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-sm bg-admin-line" aria-hidden="true" />
        <nav aria-label="Sections" className="flex flex-col gap-2">
          <NavGroups go={goAndClose} />
        </nav>
        <div className="flex flex-col gap-0.5 border-t border-admin-line pt-2.5">
          <AccountRows username={username} go={goAndClose} onSignOut={onSignOut} />
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="button" onClick={onClose}>
          close
        </button>
      </form>
    </dialog>
  );
}

function currentItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => pathname.startsWith(i.to));
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const location = useLocation();
  const username = useAppSelector(selectUsername);
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const title = currentItem(location.pathname)?.label ?? "Admin";
  useEffect(() => {
    document.title = `${title} · Squelch admin`;
  }, [title]);

  return (
    <div className="flex min-h-screen">
      <Sidebar username={username} onSignOut={onSignOut} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onSearch={() => setPaletteOpen(true)}
          onMenu={() => setMoreOpen(true)}
        />
        <main className="flex w-full max-w-[1288px] flex-1 flex-col gap-[18px] px-4 pb-[100px] pt-3.5 sm:px-6 sm:pt-[22px] md:pb-[90px]">
          <LegacyUsageBanner />
          <Routes>
            <Route path="overview" element={<ActivityPanel />} />
            <Route path="activity" element={<DashboardsPanel />} />
            <Route path="users" element={<UsersPanel />} />
            <Route path="connections" element={<ConnectionsPanel />} />
            <Route path="systems" element={<SystemsPanel />} />
            <Route path="groups" element={<GroupsTagsPanel />} />
            <Route path="apikeys" element={<ApiKeysPanel />} />
            <Route path="dirmonitors" element={<DirMonitorPanel />} />
            <Route path="forwarding" element={<ForwardingPanel />} />
            <Route path="downstreams" element={<Navigate to="/admin/forwarding" replace />} />
            <Route
              path="webhooks"
              element={<Navigate to="/admin/forwarding?tab=webhooks" replace />}
            />
            <Route path="shared-links" element={<SharedLinksPanel />} />
            <Route path="transcription" element={<TranscriptionPanel />} />
            <Route path="settings" element={<SettingsPanel />} />
            <Route path="options" element={<Navigate to="/admin/settings" replace />} />
            <Route path="logs" element={<LogsPanel />} />
            <Route path="trunk-recorder" element={<TrunkRecorderPanel />} />
            <Route path="tools" element={<ToolsPanel />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </main>
      </div>
      <Dock onMore={() => setMoreOpen(true)} moreOpen={moreOpen} />
      {moreOpen && (
        <MoreSheet
          username={username}
          onClose={() => setMoreOpen(false)}
          onSignOut={onSignOut}
        />
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

export default function Admin() {
  const token = useAppSelector(selectToken);
  const role = useAppSelector(selectRole);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [postLogout] = usePostLogoutMutation();

  useAdminWebSocket();

  if (!token) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: `${location.pathname}${location.search}${location.hash}`,
        }}
      />
    );
  }

  if (role !== "admin") {
    return (
      <div className="admin-ui flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <div className="text-5xl">🚫</div>
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="max-w-sm text-center text-base-content-dim">
          Your account does not have administrator privileges. Contact an admin
          if you believe this is a mistake.
        </p>
        <a href="/" className="btn btn-primary">
          Go to Scanner
        </a>
      </div>
    );
  }

  const handleSignOut = () => {
    postLogout()
      .unwrap()
      .catch(() => {})
      .finally(() => {
        dispatch(clearCredentials());
        navigate("/login", { replace: true });
      });
  };

  return (
    <div className="admin-ui">
      <NavigationGuardProvider>
        <ToastProvider>
          <Shell onSignOut={handleSignOut} />
        </ToastProvider>
      </NavigationGuardProvider>
    </div>
  );
}
