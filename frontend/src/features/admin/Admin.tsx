import { useState } from "react";
import {
  NavLink,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import {
  NavigationGuardProvider,
  useNavigationGuard,
} from "./_shell/useNavigationGuard";
import {
  Activity,
  Users,
  Radio,
  FolderTree,
  Key,
  FolderSearch,
  ArrowDownToLine,
  Settings,
  ScrollText,
  Wrench,
  Share2,
  LogOut,
  Home,
  Menu,
  X,
  AudioLines,
  Cable,
} from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/app/store";
import {
  selectToken,
  selectRole,
  clearCredentials,
  usePostLogoutMutation,
} from "@/features/auth";
import { useAdminWebSocket } from "./_shell/useAdminWebSocket";
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
import DashboardsPanel from "@/features/admin/dashboards";
import SharedLinksPanel from "@/features/admin/shared-links";
import TranscriptionPanel from "@/features/admin/transcription";
import LegacyUsageBanner from "@/features/admin/legacy-usage";

const navItems = [
  { to: "/admin/activity", label: "Dashboards", icon: Activity },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/connections", label: "Connections", icon: Cable },
  { to: "/admin/systems", label: "Systems", icon: Radio },
  { to: "/admin/groups", label: "Groups & Tags", icon: FolderTree },
  { to: "/admin/apikeys", label: "API Keys", icon: Key },
  { to: "/admin/dirmonitors", label: "Monitors", icon: FolderSearch },
  { to: "/admin/downstreams", label: "Downstreams", icon: ArrowDownToLine },
  { to: "/admin/shared-links", label: "Shared Links", icon: Share2 },
  { to: "/admin/transcription", label: "Transcription", icon: AudioLines },
  { to: "/admin/options", label: "Options", icon: Settings },
  { to: "/admin/logs", label: "Logs", icon: ScrollText },
  { to: "/admin/tools", label: "Tools", icon: Wrench },
] as const;

function SidebarContent({
  showLabels,
  onSignOut,
  onNavClick,
}: {
  showLabels: boolean;
  onSignOut: () => void;
  onNavClick?: () => void;
}) {
  const { requestNavigation } = useNavigationGuard();
  const navigate = useNavigate();

  const handleClick =
    (to: string, extra?: () => void) =>
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      if (requestNavigation(to)) {
        navigate(to);
        extra?.();
      }
    };

  return (
    <ul className="menu bg-base-200 h-full p-2 gap-1">
      {navItems.map(({ to, label, icon: Icon }) => (
        <li key={to}>
          <NavLink
            to={to}
            onClick={handleClick(to, onNavClick)}
            className={({ isActive }: { isActive: boolean }) =>
              isActive
                ? "border-l-4 border-primary bg-primary/10"
                : "hover:bg-base-300"
            }
          >
            <Icon className="w-5 h-5 shrink-0" />
            {showLabels && <span>{label}</span>}
          </NavLink>
        </li>
      ))}
      <li className="mt-auto">
        <NavLink
          to="/"
          onClick={handleClick("/", onNavClick)}
          className="hover:bg-base-300"
        >
          <Home className="w-5 h-5 shrink-0" />
          {showLabels && <span>Scanner</span>}
        </NavLink>
      </li>
      <li>
        <button onClick={onSignOut} className="hover:bg-base-300">
          <LogOut className="w-5 h-5 shrink-0" />
          {showLabels && <span>Sign Out</span>}
        </button>
      </li>
    </ul>
  );
}

export default function Admin() {
  const token = useAppSelector(selectToken);
  const role = useAppSelector(selectRole);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
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
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <div className="text-5xl">🚫</div>
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-base-content/70 text-center max-w-sm">
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
      <div className="drawer md:drawer-open">
        <input
          id="admin-drawer"
          type="checkbox"
          className="drawer-toggle"
          checked={drawerOpen}
          onChange={(e) => setDrawerOpen(e.target.checked)}
        />

        {/* Main content */}
        <div className="drawer-content flex flex-col min-h-screen">
          {/* Mobile top bar */}
          <div className="navbar bg-base-200 md:hidden">
            <label
              htmlFor="admin-drawer"
              className="btn btn-ghost btn-square"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </label>
          </div>

          <main className="flex-1 p-6 max-w-300 w-full mx-auto">
            <LegacyUsageBanner />
            <Routes>
              <Route path="activity" element={<DashboardsPanel />} />
              <Route path="users" element={<UsersPanel />} />
              <Route path="connections" element={<ConnectionsPanel />} />
              <Route path="systems" element={<SystemsPanel />} />
              <Route path="groups" element={<GroupsTagsPanel />} />
              <Route path="apikeys" element={<ApiKeysPanel />} />
              <Route path="dirmonitors" element={<DirMonitorPanel />} />
              <Route path="downstreams" element={<DownstreamsPanel />} />
              <Route path="options" element={<OptionsPanel />} />
              <Route path="logs" element={<LogsPanel />} />
              <Route path="tools" element={<ToolsPanel />} />
              <Route path="webhooks" element={<WebhooksPanel />} />
              <Route path="shared-links" element={<SharedLinksPanel />} />
              <Route path="transcription" element={<TranscriptionPanel />} />
              <Route path="*" element={<Navigate to="activity" replace />} />
            </Routes>
          </main>
        </div>

        {/* Sidebar */}
        <div className="drawer-side z-40">
          <label
            htmlFor="admin-drawer"
            className="drawer-overlay"
            aria-label="Close menu"
          />
          {/* Mobile: full sidebar with labels */}
          <div className="h-full md:hidden">
            <div className="flex items-center justify-end p-2 bg-base-200 md:hidden">
              <button
                className="btn btn-ghost btn-square btn-sm"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <SidebarContent
              showLabels
              onSignOut={handleSignOut}
              onNavClick={() => setDrawerOpen(false)}
            />
          </div>

          {/* md: icons only */}
          <div className="hidden md:block lg:hidden w-16 h-full">
            <SidebarContent showLabels={false} onSignOut={handleSignOut} />
          </div>

          {/* lg: icons + labels */}
          <div className="hidden lg:block w-50 h-full">
            <SidebarContent showLabels onSignOut={handleSignOut} />
          </div>
        </div>
      </div>
    </NavigationGuardProvider>
  );
}
