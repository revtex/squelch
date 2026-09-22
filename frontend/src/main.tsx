import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { store } from "@/app/store";
import { useAppSelector } from "@/app/store";
import { selectAuthReady } from "@/features/auth";
import { useAuthInit } from "@/features/auth/useAuthInit";
import { useTokenRefresh } from "@/features/auth/useTokenRefresh";
import { audioPlayer } from "@/shared/services/audio/player";
import { refreshSession } from "@/app/api";
import { applyStoredTheme } from "@/shared/hooks/useTheme";
import "@/index.css";

applyStoredTheme();

// Wire a silent auth-recovery hook into the audio player so that when an
// `<audio>` fetch returns 401 (e.g. another device pushed our access JWT
// out of the per-user concurrent-token cap) we transparently refresh the
// session cookie and retry the same call once. Routed through the shared
// single-flighted `refreshSession` so it cannot race the scheduled refresh
// or an RTK Query 401 retry — a parallel refresh would replay the
// single-use refresh cookie and trigger family revocation, logging the
// user out mid-session.
audioPlayer.setAuthRecovery(async () => {
  const result = await refreshSession(store.dispatch);
  return "data" in result;
});

const Scanner = lazy(() => import("@/features/scanner/Scanner"));
const Login = lazy(() => import("@/features/auth/Login"));
const Setup = lazy(() => import("@/features/setup/Setup"));
const Admin = lazy(() => import("@/features/admin/Admin"));
const SharedCall = lazy(() => import("@/features/shared-call/SharedCall"));

const LoadingSpinner = (
  <div className="flex items-center justify-center min-h-screen">
    <span className="loading loading-spinner loading-lg" />
  </div>
);

function App() {
  useAuthInit();
  useTokenRefresh();
  const authReady = useAppSelector(selectAuthReady);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-base-100 text-base-content">
        {LoadingSpinner}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100 text-base-content">
      <Suspense fallback={LoadingSpinner}>
        <Routes>
          <Route path="/" element={<Scanner />} />
          <Route path="/scanner" element={<Scanner />} />
          <Route path="/login" element={<Login />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/admin/*" element={<Admin />} />
          <Route path="/call/:token" element={<SharedCall />} />
        </Routes>
      </Suspense>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>,
);
