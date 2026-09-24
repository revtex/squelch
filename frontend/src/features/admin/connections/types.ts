import type { ConnectionHistoryFilter } from "@/types";

/** Filter the History tab to one address or one account and switch to it. */
export type HistoryLink = (
  filter: Pick<ConnectionHistoryFilter, "ip" | "userId"> & { label?: string },
) => void;
