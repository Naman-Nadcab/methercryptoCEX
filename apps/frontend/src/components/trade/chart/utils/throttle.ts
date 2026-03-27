/** Leading-edge throttle for high-frequency events (e.g. crosshair). */
export function throttleLeading<A>(ms: number, fn: (arg: A) => void): (arg: A) => void {
  let last = 0;
  let trailingTimer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | undefined;
  return (arg: A) => {
    pending = arg;
    const now = Date.now();
    const remaining = ms - (now - last);
    if (remaining <= 0) {
      if (trailingTimer) {
        clearTimeout(trailingTimer);
        trailingTimer = null;
      }
      last = now;
      fn(pending as A);
      return;
    }
    if (trailingTimer) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(() => {
      trailingTimer = null;
      last = Date.now();
      fn(pending as A);
    }, remaining);
  };
}
