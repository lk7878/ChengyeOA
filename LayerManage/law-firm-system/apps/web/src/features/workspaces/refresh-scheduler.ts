/** Coalesce notifications without replacing active drafts. Security events bypass this queue. */
export function createRefreshScheduler(refresh: () => void, paused: () => boolean, delay: number | (() => number) = 30_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const queue = () => {
    if (disposed || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      if (disposed) return;
      if (paused()) queue();
      else refresh();
    }, typeof delay === 'function' ? delay() : delay);
  };
  return {
    queue,
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}
