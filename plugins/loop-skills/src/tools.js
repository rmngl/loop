// The three tools an agent can call. Every failure is a sentence the agent can
// act on — nothing here throws into a turn, because a thrown tool error ends the
// agent's work rather than teaching it.

import { DESCRIPTION_MAX, SLUG_MAX } from "./format.js";
import { helperRequest, parseReply } from "./request.js";

const slug = {
  type: "string",
  minLength: 1,
  maxLength: SLUG_MAX,
  pattern: "^[a-z0-9][a-z0-9._-]*$",
};

export const TOOLS = [
  {
    name: "skills_list",
    description:
      "List the procedures the owner has approved. Returns one slug and one line each. Call skills_read before doing a task one of them covers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "skills_read",
    description:
      "Read one approved procedure in full by slug. Drafts are not readable until the owner approves them.",
    inputSchema: {
      type: "object",
      properties: { slug },
      required: ["slug"],
      additionalProperties: false,
    },
  },
  {
    name: "skills_draft",
    description:
      "Propose a repeatable procedure for the owner to review. Use it once when a task taught you something you would otherwise have to be told again. The draft is not visible to any agent until the owner approves it.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { ...slug, description: "Short kebab-case id, e.g. weekly-sales-report" },
        name: { type: "string", minLength: 1, maxLength: 80 },
        description: { type: "string", minLength: 1, maxLength: DESCRIPTION_MAX, description: "One line saying when to use it" },
        body: { type: "string", minLength: 1, maxLength: 61440, description: "The procedure, in markdown" },
        why: { type: "string", minLength: 1, maxLength: 400, description: "One line: what would have to be re-explained next time" },
      },
      required: ["slug", "name", "description", "body", "why"],
      additionalProperties: false,
    },
  },
];

/** One `spawn` call, with a timeout so a hung helper does not hold the turn. */
async function send(deps, command, payload) {
  const timeoutMs = deps.timeoutMs ?? 20_000;
  let timer;
  try {
    // A spawn failure is a normal outcome (no desktop, no permission), so it is
    // converted here rather than escaping to the outer catch, which would report
    // it without the sentence the agent needs.
    const work = (async () => {
      try {
        const result = await deps.spawn(command, payload);
        return parseReply(result?.stdout);
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    })();
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, error: `the ${command} step did not finish in time` }), timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } finally {
    // The timer outlives the call otherwise, which keeps the plugin's process
    // graph alive for 20 s after every single tool call.
    clearTimeout(timer);
  }
}

function approvedList(skills) {
  return (Array.isArray(skills) ? skills : [])
    .filter((s) => s && s.state === "approved")
    .sort((a, b) => String(b.approvedAt ?? "").localeCompare(String(a.approvedAt ?? "")));
}

const failureSentence = (reply, command) => {
  const error = String(reply?.error ?? "");
  if (/desktop|not available|unsupported/i.test(error)) {
    return `I couldn't write to the skills folder: ${error}. Procedures need the desktop app.`;
  }
  if (/absolute/i.test(error)) return `I couldn't write to the skills folder: ${error}.`;
  return `I couldn't ${command}: ${error || "the helper returned nothing"}`;
};

/**
 * @param deps { spawn: (command, payload) => Promise<{stdout}>, root: string, notifyDraft?: Function, timeoutMs?: number }
 * @returns a sentence for the agent. Never throws.
 */
export async function callTool(deps, name, args = {}, context = {}) {
  try {
    if (name === "skills_list") {
      const reply = await send(deps, "list", { root: deps.root });
      if (!reply.ok) return failureSentence(reply, "read the list of skills");
      const approved = approvedList(reply.data?.skills);
      if (approved.length === 0) {
        return "No approved skills yet. If this task taught you something repeatable, call skills_draft once to propose it.";
      }
      const lines = approved.map((s) => `- ${s.slug} — ${s.description || s.name || s.slug}`);
      return ["Approved skills:", ...lines, "", "Call skills_read with a slug before doing a task one of them covers."].join("\n");
    }

    if (name === "skills_read") {
      if (typeof args.slug !== "string" || !args.slug) return "I need a slug to read. Call skills_list first.";
      const reply = await send(deps, "read", { root: deps.root, slug: args.slug });
      if (!reply.ok) {
        return `"${args.slug}" is not readable until the owner approves it. Use skills_list to see what is approved.`;
      }
      const body = String(reply.data?.body ?? reply.data?.text ?? "");
      return body || `"${args.slug}" has no body yet.`;
    }

    if (name === "skills_draft") {
      // Checked here, before the disk, so a bad argument costs nothing and the
      // agent gets the number it violated rather than a helper-internal error.
      const description = String(args.description ?? "");
      if ([...description].length > DESCRIPTION_MAX) {
        return `The description must be at most ${DESCRIPTION_MAX} characters; this one is ${[...description].length}. Shorten it to one line and try again.`;
      }
      const reply = await send(deps, "draft", {
        root: deps.root,
        slug: args.slug,
        name: args.name,
        description,
        body: args.body,
        why: args.why,
        channel: context.channel ?? "",
        agent: context.agent ?? context.session ?? "agent",
      });
      if (!reply.ok) {
        if (reply.error === "pending") {
          return `A draft for "${args.slug}" is already waiting for the owner. Do not draft it again.`;
        }
        if (reply.error === "rejected") {
          return `The owner rejected an earlier draft of "${args.slug}"${reply.reason ? `: ${reply.reason}` : "."} Do not resubmit it unchanged; act on the reason.`;
        }
        if (reply.error === "already-approved") {
          return `"${args.slug}" is already an approved skill. Read it instead of drafting it.`;
        }
        return failureSentence(reply, "save the draft");
      }
      if (typeof deps.notifyDraft === "function") {
        try { await deps.notifyDraft({ slug: args.slug, name: args.name }); } catch { /* a missed notification is not a failed draft */ }
      }
      return `Draft saved and waiting for the owner to review it: ${args.slug}. It is not visible to any agent until they approve it, so keep working without it.`;
    }

    return `Unknown tool: ${name}`;
  } catch (error) {
    return `That did not work: ${String(error?.message ?? error)}`;
  }
}

/** The one line the plugin sends per call; kept here so the spawn wiring is tiny. */
export const requestFor = helperRequest;
