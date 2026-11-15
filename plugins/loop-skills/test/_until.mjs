// Plugins do their work in the background: `apply` kicks off a spawn, the node
// helper reads the skills folder, and only then does a block appear. A test has
// to wait for that, but a fixed sleep is a bet on how busy the machine is. It
// lost that bet while a Rust build held all twelve cores, and four tests failed
// with "0 !== 1" against unchanged source.
//
// So: poll the condition, and fail with what was actually there.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve once `check()` returns something truthy, or reject naming `label`.
 * Ten seconds is far longer than any real settle, and still far shorter than a
 * hung test's timeout.
 */
export async function until(check, label, { timeoutMs = 10_000, stepMs = 25 } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await wait(stepMs);
  }
}

/** Resolve once the map has at least `count` entries; returns the map. */
export const untilSize = (map, count, label) =>
  until(() => map.size >= count && map, label ?? `${count} entries, saw ${map.size}`);

export { wait };
