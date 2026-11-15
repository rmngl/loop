// Owns the single <plugin-instructions> block.
//
// Two constraints shape this, both from the host:
//   - `addInstructions` THROWS above 4096 UTF-8 bytes; it does not truncate.
//     `buildInjection` never exceeds it, but a failure here must still not reach
//     the agent's turn.
//   - A second registration of the same contribution id throws, and two
//     revisions of the plugin can be alive at once during a reload. So the
//     previous block is disposed *before* the next is registered, and an
//     identical text registers nothing at all.

import { buildInjection } from "./index.js";

export class InjectionHolder {
  #register;
  #onError;
  #build;
  #text;
  #release;

  /**
   * @param register (text) => dispose — registers the block, returns its handle
   * @param onError (error) => void — called instead of throwing
   * @param build (entries, options) => { text } — injectable for the failure path
   */
  constructor(register, onError = () => {}, build = buildInjection) {
    this.#register = register;
    this.#onError = onError;
    this.#build = build;
    this.#text = undefined;
    this.#release = undefined;
  }

  /** Rebuild and, if the text changed, replace the live block. Never throws. */
  set(entries, options = {}) {
    let text;
    try {
      const result = this.#build(entries, options);
      text = typeof result === "string" ? result : result?.text;
      if (typeof text !== "string" || !text) throw new Error("injection text was empty");
    } catch (error) {
      // The previous block stays live; an agent keeps the procedures it had.
      this.#onError(error);
      return;
    }

    // The common case: a tool call that changed nothing worth re-registering.
    if (text === this.#text) return;

    const previous = this.#release;
    this.#release = undefined;
    // Dispose first: registering the same id twice throws, and the throw would
    // leave the plugin with neither block.
    if (previous) {
      try { previous(); } catch { /* already gone */ }
    }
    try {
      this.#release = this.#register(text);
      this.#text = text;
    } catch (error) {
      // The only way this throws is a *previous revision* of the plugin still
      // holding the id, which owns a scope this one cannot dispose. That block
      // is still delivering procedures, so keeping it is the right outcome:
      // agents lose nothing, and the host's normal reload order (dispose then
      // apply) never reaches this path. Verified in both orders.
      this.#text = undefined;
      this.#onError(error);
    }
  }

  /** Idempotent: removing a block that is not there is not an error. */
  dispose() {
    const release = this.#release;
    this.#release = undefined;
    this.#text = undefined;
    if (!release) return;
    try { release(); } catch { /* already gone */ }
  }
}
