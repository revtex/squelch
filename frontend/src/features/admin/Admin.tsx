import { useCallback, useEffect, useState, type MouseEvent } from "react";
import {
  NavLink,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  ChevronDown,
  Home,
  LogOut,
  Menu,
  Search,
  UserRound,
} from "lucide-react";
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
  DetailsPanel,
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
import DownstreamsPanel from "@/features/admin/downstreams";
import OptionsPanel from "@/features/admin/options";
import LogsPanel from "@/features/admin/logs";
import ToolsPanel from "@/features/admin/tools";
import WebhooksPanel from "@/features/admin/webhooks";
import DashboardsPanel, {
  ActivityPanel,
  TrMqttPanel,
} from "@/features/admin/dashboards";
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

function Sidebar({ onSignOut }: { onSignOut: () => void }) {
  const go = useGuardedNavigate();
  return (
    <aside className="sticky top-0 hidden h-screen w-24 shrink-0 flex-col border-r border-base-300 bg-base-200 md:flex lg:w-56">
      <div className="flex h-12 items-center px-3 lg:px-4">
        <span className="font-sign text-2xl leading-none tracking-wide max-lg:sr-only">
          SQUELCH
        </span>
        <span className="font-sign text-2xl leading-none lg:hidden" aria-hidden="true">
          SQ
        </span>
      </div>
      <nav
        aria-label="Admin sections"
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin]"
      >
        <ul className="menu w-full gap-0.5 px-2 max-lg:px-1">
          {NAV_GROUPS.map((g) => (
            <li key={g.title}>
              <h2 className="menu-title max-lg:sr-only">{g.title}</h2>
              <ul className="max-lg:ml-0 max-lg:border-l-0 max-lg:pl-0">
                {g.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={go(item.to)}
                      className={({ isActive }) =>
                        `max-lg:grid-flow-row max-lg:justify-items-center max-lg:gap-0.5 max-lg:px-1 max-lg:py-1.5 ${
                          isActive ? "menu-active" : ""
                        }`
                      }
                    >
                      <item.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                      <span className="max-lg:w-full max-lg:text-center max-lg:text-[10px] max-lg:leading-tight">
                        {item.label}
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </nav>
      <ul className="menu w-full gap-0.5 border-t border-base-300 px-2">
        <li>
          <NavLink
            to="/"
            onClick={go("/")}
            className="max-lg:grid-flow-row max-lg:justify-items-center max-lg:gap-0.5 max-lg:px-1 max-lg:py-1.5"
          >
            <Home className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="max-lg:text-[10px]">Scanner</span>
          </NavLink>
        </li>
        <li>
          <button
            type="button"
            onClick={onSignOut}
            className="max-lg:grid-flow-row max-lg:justify-items-center max-lg:gap-0.5 max-lg:px-1 max-lg:py-1.5"
          >
            <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="max-lg:text-[10px]">Sign out</span>
          </button>
        </li>
      </ul>
    </aside>
  );
}

const STATUS_LABEL = {
  connected: "Live",
  connecting: "Reconnecting…",
  offline: "Offline",
} as const;
const STATUS_DOT = {
  connected: "bg-success",
  connecting: "bg-warning",
  offline: "bg-error",
} as const;

function SocketStatus() {
  const status = useAdminWsStatus();
  return (
    <span
      role="status"
      className="badge badge-ghost gap-1.5 text-xs"
      title="The admin's live connection to the server"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[status]}`}
        aria-hidden="true"
      />
      {STATUS_LABEL[status]}
    </span>
  );
}

function TopBar({
  title,
  username,
  onSearch,
  onSignOut,
}: {
  title: string;
  username: string | null;
  onSearch: () => void;
  onSignOut: () => void;
}) {
  const go = useGuardedNavigate();
  return (
    <header className="sticky top-0 z-30 flex min-h-12 items-center gap-2 border-b border-base-300 bg-base-100/95 px-3 backdrop-blur sm:px-4">
      <span className="font-sign text-xl leading-none tracking-wide md:hidden">
        SQUELCH
      </span>
      <p className="truncate text-sm font-semibold text-base-content/70 max-md:sr-only">
        {title}
      </p>
      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-2"
          onClick={onSearch}
          aria-keyshortcuts="Control+K"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          <span className="max-sm:sr-only">Go to</span>
          <kbd className="kbd kbd-xs max-sm:hidden">Ctrl K</kbd>
        </button>
        <SocketStatus />
        <div className="dropdown dropdown-end">
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-1"
            aria-label={`Account menu for ${username ?? "admin"}`}
            aria-haspopup="menu"
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            <span className="max-w-32 truncate max-sm:hidden">{username}</span>
            <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
          </button>
          <ul
            role="menu"
            className="dropdown-content menu z-40 mt-1 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow"
          >
            <li role="none">
              <NavLink to="/" role="menuitem" onClick={go("/")}>
                <Home className="h-4 w-4" aria-hidden="true" />
                Scanner
              </NavLink>
            </li>
            <li role="none">
              <button type="button" role="menuitem" onClick={onSignOut}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
}

function Dock({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const go = useGuardedNavigate();
  const location = useLocation();
  const inDock = DOCK_ITEMS.some((i) => location.pathname.startsWith(i.to));
  return (
    <nav aria-label="Admin sections" className="dock dock-sm z-30 md:hidden">
      {DOCK_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={go(item.to)}
          className={({ isActive }) => (isActive ? "dock-active" : "")}
        >
          <item.icon className="h-5 w-5" aria-hidden="true" />
          <span className="dock-label">{item.label}</span>
        </NavLink>
      ))}
      <button
        type="button"
        className={moreOpen || !inDock ? "dock-active" : ""}
        aria-expanded={moreOpen}
        onClick={onMore}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
        <span className="dock-label">More</span>
      </button>
    </nav>
  );
}

function MoreSheet({
  onClose,
  onSignOut,
}: {
  onClose: () => void;
  onSignOut: () => void;
}) {
  const go = useGuardedNavigate();
  return (
    <DetailsPanel title="All sections" onClose={onClose}>
      <ul className="menu w-full p-0">
        {NAV_GROUPS.map((g) => (
          <li key={g.title}>
            <h2 className="menu-title">{g.title}</h2>
            <ul>
              {g.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    onClick={go(item.to, onClose)}
                    className={({ isActive }) => (isActive ? "menu-active" : "")}
                  >
                    <item.icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
        ))}
        <li>
          <h2 className="menu-title">Account</h2>
          <ul>
            <li>
              <NavLink to="/" onClick={go("/", onClose)}>
                <Home className="h-4 w-4" aria-hidden="true" />
                Scanner
              </NavLink>
            </li>
            <li>
              <button type="button" onClick={onSignOut}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </button>
            </li>
          </ul>
        </li>
      </ul>
    </DetailsPanel>
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
      <Sidebar onSignOut={onSignOut} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          username={username}
          onSearch={() => setPaletteOpen(true)}
          onSignOut={onSignOut}
        />
        <main className="mx-auto w-full max-w-300 flex-1 p-4 pb-24 sm:p-6 md:pb-6">
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
            <Route path="downstreams" element={<DownstreamsPanel />} />
            <Route path="webhooks" element={<WebhooksPanel />} />
            <Route path="shared-links" element={<SharedLinksPanel />} />
            <Route path="transcription" element={<TranscriptionPanel />} />
            <Route path="options" element={<OptionsPanel />} />
            <Route path="logs" element={<LogsPanel />} />
            <Route path="trunk-recorder" element={<TrMqttPanel />} />
            <Route path="tools" element={<ToolsPanel />} />
            <Route path="*" element={<Navigate to="overview" replace />} />
          </Routes>
        </main>
      </div>
      <Dock onMore={() => setMoreOpen(true)} moreOpen={moreOpen} />
      {moreOpen && (
        <MoreSheet onClose={() => setMoreOpen(false)} onSignOut={onSignOut} />
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
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <div className="text-5xl">🚫</div>
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="max-w-sm text-center text-base-content/70">
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
    <NavigationGuardProvider>
      <ToastProvider>
        <Shell onSignOut={handleSignOut} />
      </ToastProvider>
    </NavigationGuardProvider>
  );
}
