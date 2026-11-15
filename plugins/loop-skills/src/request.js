// How the plugin talks to its child process.
//
// Measured constraint, not a preference: Windows caps a whole process command
// line at 32767 characters, and a 32 KB ASCII draft body in argv already fails
// with ENAMETOOLONG. A draft body may be 60 KB. So the helper SOURCE travels in
// argv (`-e`) and the REQUEST travels on stdin.

import { HELPER_SOURCE } from "./helper.js";

/** `[--input-type=module, -e, <source>]` — the argv for `ctx.host.spawn`. */
export function helperArgs() {
  return ["--input-type=module", "-e", HELPER_SOURCE];
}

/** The one line the helper reads from stdin. Never an argument. */
export function helperRequest(command, payload = {}) {
  return JSON.stringify({ command, ...payload });
}

/**
 * The helper prints exactly one JSON object. A stray line must not be able to
 * fake success, so the LAST parseable object wins; anything unparseable is a
 * reported failure, never a throw into the agent's turn.
 */
export function parseReply(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return { ok: false, error: "helper printed no result" };
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === "object" && typeof value.ok === "boolean") return value;
    } catch {
      // keep looking further back
    }
  }
  return { ok: false, error: "helper printed no result" };
}
