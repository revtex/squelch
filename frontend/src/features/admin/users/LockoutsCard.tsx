import {
  Card,
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
    <Card
      title="Sign-in lockouts"
      count={lockouts.length}
      meta={`${MAX_FAILURES} failures lock an address out for 10 minutes`}
      bodyClassName=""
    >
      <ul>
        {lockouts.map((l) => (
          <li
            key={l.ip}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-admin-line2 px-4 py-2.5 text-sm last:border-b-0"
          >
            <span className={`badge ${l.lockedUntil ? "badge-error" : "badge-warning"}`}>
              {l.lockedUntil ? "locked" : "counting"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-mono">{l.ip}</span>
              <span className="block text-xs text-base-content-dim sm:ml-2 sm:inline">
                {l.lockedUntil
                  ? `lifts ${formatUntil(l.lockedUntil)}`
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
    </Card>
  );
}
