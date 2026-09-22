import {
  EllipsisVertical,
  LogIn,
  LogOut,
  Settings,
  Info,
  KeyRound,
  Palette,
  Sun,
  Star,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@/shared/hooks/useTheme";
import { useLcdBrightness } from "../hooks/useLcdBrightness";
import { ThemePicker } from "./ThemePicker";
import { useAppSelector, useAppDispatch } from "@/app/store";
import {
  selectToken,
  selectRole,
  selectUsername,
  clearCredentials,
  usePostLogoutMutation,
} from "@/features/auth";
import { useChangePasswordMutation } from "@/features/auth";

interface LEDPanelProps {
  /** Opens the bookmarks panel; omitted for anonymous listeners. */
  onToggleBookmarks?: () => void;
}

export function LEDPanel({ onToggleBookmarks }: LEDPanelProps = {}) {
  const { label: themeLabel } = useTheme();
  const { brightness, setBrightness } = useLcdBrightness();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const token = useAppSelector(selectToken);
  const role = useAppSelector(selectRole);
  const username = useAppSelector(selectUsername);
  const config = useAppSelector((s) => s.scanner.config);
  const isLive = useAppSelector((s) => s.scanner.isLive);
  const isPaused = useAppSelector((s) => s.scanner.isPaused);
  const isAudioActive = useAppSelector((s) => s.scanner.isAudioActive);
  const currentCall = useAppSelector((s) => s.scanner.currentCall);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [brightnessOpen, setBrightnessOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwToast, setPwToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);
  const [changePassword] = useChangePasswordMutation();
  const [postLogout] = usePostLogoutMutation();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const branding = config?.branding?.trim() || "SQUELCH";

  // LED state — colours come from the active theme:
  // Live off:          off (always)
  // Paused (live on):  paused + blink
  // Live + receiving:  live (or the TG's own colour) with glow
  // Live + idle:       live, dimmer (no glow)
  let ledState: "off" | "paused" | "receiving" | "idle";
  let ledColor: string;
  if (!isLive) {
    ledState = "off";
    ledColor = "var(--led-off)";
  } else if (isPaused) {
    ledState = "paused";
    ledColor = "var(--led-paused)";
  } else if (isAudioActive) {
    ledState = "receiving";
    ledColor = currentCall?.talkgroupLedColor || "var(--led-live)";
  } else {
    ledState = "idle";
    ledColor = "var(--led-live)";
  }
  const dimmed = ledState === "off" || ledState === "idle";
  const shouldBlink = ledState === "paused";

  const closeMenuAnd = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  const handleSignOut = () => {
    postLogout()
      .unwrap()
      .catch(() => {})
      .finally(() => {
        dispatch(clearCredentials());
        navigate("/login", { replace: true });
      });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      setPwToast({
        msg: "New password must be at least 8 characters",
        type: "error",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwToast({ msg: "Passwords do not match", type: "error" });
      return;
    }
    try {
      await changePassword({ currentPassword, newPassword }).unwrap();
      setPwToast({ msg: "Password changed successfully", type: "success" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordOpen(false), 1500);
    } catch {
      setPwToast({ msg: "Failed to change password", type: "error" });
    }
    setTimeout(() => setPwToast(null), 4000);
  };

  return (
    <div className="flex items-center gap-3 mb-3 overflow-visible">
      <span className="flex-1 min-w-0 truncate font-mono text-sm tracking-brand uppercase text-base-content-dim">
        {branding}
      </span>
      <div
        data-testid="led"
        data-state={ledState}
        role="img"
        aria-label={
          ledState === "off"
            ? "Live off"
            : ledState === "paused"
              ? "Paused"
              : ledState === "receiving"
                ? "Receiving"
                : "Live, idle"
        }
        className={`led-indicator shrink-0 rounded ${shouldBlink ? "animate-pulse" : ""}`}
        style={{
          backgroundColor: ledColor,
          boxShadow: dimmed
            ? "none"
            : `0 0 8px ${ledColor}, 0 0 16px ${ledColor}`,
          opacity: dimmed ? 0.5 : 1,
          animationTimingFunction: shouldBlink ? "step-end" : undefined,
        }}
      />
      <div className="relative" ref={menuRef}>
        <button
          className="btn btn-ghost btn-sm btn-circle"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <EllipsisVertical className="w-4 h-4" />
        </button>
        {menuOpen && (
          <ul className="absolute right-0 top-full mt-1 menu p-2 shadow-lg bg-base-200 rounded-box w-60 z-100 border border-base-300">
            {token && username && (
              <li className="menu-title truncate">Signed in as {username}</li>
            )}
            <li>
              <button onClick={closeMenuAnd(() => setThemeOpen(true))}>
                <Palette className="w-4 h-4" /> Theme
                <span className="ml-auto text-xs text-base-content-dim">
                  {themeLabel}
                </span>
              </button>
            </li>
            <li>
              <button onClick={closeMenuAnd(() => setBrightnessOpen(true))}>
                <Sun className="w-4 h-4" /> Display brightness
              </button>
            </li>
            {onToggleBookmarks && (
              <li>
                <button onClick={closeMenuAnd(onToggleBookmarks)}>
                  <Star className="w-4 h-4" /> Bookmarks
                </button>
              </li>
            )}
            {token && role === "admin" && (
              <li>
                <button
                  onClick={closeMenuAnd(() => navigate("/admin/activity"))}
                >
                  <Settings className="w-4 h-4" /> Admin Panel
                </button>
              </li>
            )}
            {token && (
              <li>
                <button onClick={closeMenuAnd(() => setPasswordOpen(true))}>
                  <KeyRound className="w-4 h-4" /> Change Password
                </button>
              </li>
            )}
            <li>
              <button onClick={closeMenuAnd(() => setAboutOpen(true))}>
                <Info className="w-4 h-4" /> About
              </button>
            </li>
            {token ? (
              <li>
                <button onClick={closeMenuAnd(handleSignOut)}>
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </li>
            ) : (
              <li>
                <button onClick={closeMenuAnd(() => navigate("/login"))}>
                  <LogIn className="w-4 h-4" /> Sign in
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      <ThemePicker isOpen={themeOpen} onClose={() => setThemeOpen(false)} />

      {/* Brightness modal */}
      {brightnessOpen && (
        <dialog
          className="modal modal-open"
          onClick={() => setBrightnessOpen(false)}
        >
          <div
            className="modal-box max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg mb-4">Display brightness</h3>
            <input
              type="range"
              min={20}
              max={120}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              className="range range-sm range-primary w-full"
              aria-label="Display brightness"
            />
            <div className="modal-action">
              <button
                className="btn btn-sm"
                onClick={() => setBrightnessOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* About modal */}
      {aboutOpen && (
        <dialog
          className="modal modal-open"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="modal-box max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg mb-4">About</h3>
            <div className="space-y-2 text-sm">
              {branding !== "SQUELCH" && (
                <div>
                  <span className="opacity-60">Instance:</span>{" "}
                  <span className="font-semibold">{branding}</span>
                </div>
              )}
              <div>
                <span className="opacity-60">Version:</span>{" "}
                <span>{config?.version || "—"}</span>
              </div>
              {config?.email && (
                <div>
                  <span className="opacity-60">Support:</span>{" "}
                  <a
                    href={`mailto:${config.email}`}
                    className="link link-primary"
                  >
                    {config.email}
                  </a>
                </div>
              )}
            </div>
            <div className="modal-action">
              <button
                className="btn btn-sm"
                onClick={() => setAboutOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </dialog>
      )}

      {/* Change Password modal */}
      {passwordOpen && (
        <dialog
          className="modal modal-open"
          onClick={() => setPasswordOpen(false)}
        >
          <div
            className="modal-box max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg mb-4">Change Password</h3>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <label className="flex flex-col w-full">
                <span className="text-sm">Current Password</span>
                <input
                  type="password"
                  className="input w-full"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </label>
              <label className="flex flex-col w-full">
                <span className="text-sm">New Password</span>
                <input
                  type="password"
                  className="input w-full"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <label className="flex flex-col w-full">
                <span className="text-sm">Confirm New Password</span>
                <input
                  type="password"
                  className="input w-full"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              {pwToast && (
                <div
                  className={`text-sm ${
                    pwToast.type === "success" ? "text-success" : "text-error"
                  }`}
                >
                  {pwToast.msg}
                </div>
              )}
              <div className="modal-action">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setPasswordOpen(false);
                    setPwToast(null);
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Change Password
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </div>
  );
}
