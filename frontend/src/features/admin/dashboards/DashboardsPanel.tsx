// The old Dashboards page. Its two tabs are pages of their own now; this
// keeps `/admin/activity` and `/admin/activity?dashTab=trmqtt` links working.
import { Navigate, useSearchParams } from "react-router-dom";

export default function DashboardsPanel() {
  const [params] = useSearchParams();
  const to =
    params.get("dashTab") === "trmqtt"
      ? "/admin/trunk-recorder"
      : "/admin/overview";
  return <Navigate to={to} replace />;
}
