/**
 * Reloads the page once when a script chunk fails to load (a tab opened
 * before a deploy, or a dropped request), instead of leaving it broken.
 *
 * Runs as an inline script before any chunk loads, so this function must be
 * self-contained: it is serialized with `toString()` into the page.
 * sessionStorage makes it at most one reload per tab every ten minutes, so a
 * chunk that is truly gone can never loop. It never reloads while a diagram
 * is being generated (`data-generating` on <html>): that would cancel the run.
 */
export function installChunkReload(win: Window) {
  const key = "gitdiagram:chunk-reload-at";
  const minimumGapMs = 10 * 60 * 1000;
  const pattern =
    /Failed to load chunk|Loading (CSS )?chunk [^ ]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;

  function isChunkError(reason: unknown) {
    if (!reason) return false;
    if (typeof reason === "string") return pattern.test(reason);
    if (typeof reason !== "object") return false;
    const { name, message } = reason as { name?: unknown; message?: unknown };
    return (
      name === "ChunkLoadError" ||
      (typeof message === "string" && pattern.test(message))
    );
  }

  function reloadOnce(reason: unknown) {
    if (!isChunkError(reason)) return;
    if (win.document.documentElement.hasAttribute("data-generating")) return;
    try {
      const last = Number(win.sessionStorage.getItem(key));
      if (last && Date.now() - last < minimumGapMs) return;
      win.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Without storage there is no loop guard, so never reload.
      return;
    }
    // Keeps the URL, query and hash.
    win.location.reload();
  }

  win.addEventListener("error", (event) => {
    reloadOnce((event as ErrorEvent).error ?? (event as ErrorEvent).message);
  });
  win.addEventListener("unhandledrejection", (event) => {
    reloadOnce((event as PromiseRejectionEvent).reason);
  });
}

export const chunkReloadScript = `(${installChunkReload.toString()})(window);`;
