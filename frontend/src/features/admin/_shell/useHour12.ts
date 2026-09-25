import { useGetConfigQuery } from "./useAdminWsOps";

/** The server's 12-hour clock setting; off (24-hour) until it has loaded. */
export function useHour12(): boolean {
  const { data } = useGetConfigQuery();
  return data?.settings.find((s) => s.key === "time12hFormat")?.value === "true";
}
