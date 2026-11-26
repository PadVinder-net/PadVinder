import { useEffect, useRef } from "react";

/**
 * Runs `onSuccess` when a mutation's status turns to "success". Not a callback of `mutate`: a
 * mutation that failed with `passkey_required` is sent again after the confirmation, and only its
 * state, not those callbacks, sees that success.
 */
export function useOnSuccess(status: string, onSuccess: () => void) {
  const latest = useRef(onSuccess);
  useEffect(() => {
    latest.current = onSuccess;
  });
  useEffect(() => {
    if (status === "success") latest.current();
  }, [status]);
}
