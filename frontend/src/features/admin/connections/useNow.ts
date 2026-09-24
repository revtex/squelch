import { useEffect, useState } from "react";

/** Current unix time in seconds, re-rendering every intervalMs. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
