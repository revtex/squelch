import { ShieldAlert } from "lucide-react";
import {
  formatAgo,
  formatUntil,
  useClearLockoutMutation,
  useListLockoutsQuery,
  useToast,
} from "@/features/admin/_shell";

const MAX_FAILURES = 3;

/**
 * Addresses the sign-in limiter is keeping out, with a way to let them back
 * in. Shown only while there is something to show.
 */
export default function LockoutsCard() {
  const { data, refetch } = useListLockoutsQuery();
  const [clear] = useClearLockoutMutation();
  const toast = useToast();
  const lockouts = data?.lockouts ?? [];
  if (lockouts.length === 0) return null;

  const onClear = async (ip: string) => {
    try {
      await clear(ip).unwrap();
      toast.success(`${ip} can try to sign in again.`);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to clear the lockout.");
    }
  };

  return (
    <section
      aria-labelledby="lockouts-title"
      className="rounded-box border border-warning/40 bg-base-200 p-4"
    >
      <h3 id="lockouts-title" className="flex items-center gap-2 font-semibold">
        <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
        Sign-in lockouts
      </h3>
      <p className="mt-1 text-sm text-base-content/60">
        An address is locked out for ten minutes after {MAX_FAILURES} failed
        sign-ins. Clear one to let it try again now.
      </p>
      <ul className="mt-3 divide-y divide-base-300">
        {lockouts.map((l) => (
          <li
            key={l.ip}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="font-mono">{l.ip}</span>
              <span className="ml-2 text-base-content/60">
                {l.lockedUntil
                  ? `locked, lifts ${formatUntil(l.lockedUntil)}`
                  : `${l.failures} of ${MAX_FAILURES} attempts used`}
                {" · "}last failure {formatAgo(l.lastFailure)}
              </span>
            </span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void onClear(l.ip)}
            >
              Clear
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
