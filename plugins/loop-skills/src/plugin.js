// Registration only. Everything else is a module above; see scripts/build.mjs.
//
// The host loads this module from a blob URL, so it must not import anything and
// must not do work at top level. `inject` is a module export, not a call.
//
// What this registers:
//   - three agent tools (skills_list, skills_read, skills_draft)
//   - one <plugin-instructions> block, kept under the host's 4096-byte cap
//   - a settings card that is the library humans approve from
//   - one notification, so a draft arrives quietly instead of as a banner
//
// It registers no agent tab in v1: that surface is not on the documented steady
// set, and the settings card is canonical. A tab is a later convenience.

export const inject = ["agents", "settingsCards", "notifications", "host"];

const SKILLS_ROOT = "~/.buzz/SKILLS";

/**
 * The spawn the tools use. The request travels on stdin, never in argv: Windows
 * caps a whole command line at 32767 characters and a draft body may be 60 KB.
 */
function makeSpawn(ctx, timeoutMs = 20_000) {
  return async (command, payload) => {
    const child = await ctx.host.spawn("skills", { args: helperArgs() });
    let stdout = "";
    child.onStdout?.((data) => { stdout += data; });
    const collected = new Promise((resolve) => {
      child.exited.then(() => resolve(stdout)).catch(() => resolve(stdout));
    });
    let timer;
    try {
      await child.write(helperRequest(command, payload));
      await child.end();
      const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => resolve(stdout), timeoutMs);
      });
      return { stdout: String(await Promise.race([collected, timedOut]) ?? "") };
    } finally {
      // An uncleared timer holds the process graph open for 20 s after every
      // call, which is visible as a test run that takes 20 s per tool test.
      clearTimeout(timer);
    }
  };
}

export function apply(ctx) {
  let root;
  let rootFailed;
  const rootReady = (async () => {
    try {
      root = await ctx.host.resolveDirectory(SKILLS_ROOT, { create: true });
    } catch (error) {
      // Without a root every tool still answers with a sentence, so a missing
      // folder is a degraded plugin, not a broken one.
      rootFailed = String(error?.message ?? error);
    }
    return root;
  })();

  const spawn = makeSpawn(ctx);

  let notifyDraft = async () => {};
  try {
    const draftNotification = ctx.notifications.register({ id: "draft", label: "Skill draft" });
    const announced = new Set();
    notifyDraft = async ({ slug, name }) => {
      if (announced.has(slug)) return;
      announced.add(slug);
      await draftNotification.submit({
        sourceKey: slug,
        target: { version: 1, kind: "plugin", pluginId: "loop.skills", pageId: "library" },
        title: "스킬 초안",
        body: String(name ?? slug),
      });
    };
  } catch {
    // No notifications on this surface; drafting still works.
  }

  const deps = () => ({ spawn, root: root ?? "", notifyDraft, timeoutMs: 20_000 });

  // Owns the <plugin-instructions> block. A child scope is used because
  // addInstructions has no removal handle of its own, and registering the same
  // id twice throws — so replacing the block means disposing the scope.
  const holder = new InjectionHolder(
    (text) => {
      const scope = ctx.plugin({
        inject: ["agents"],
        apply: (child) => child.agents.addInstructions({ id: "skills-index", text }),
      });
      return () => scope.dispose();
    },
    (error) => console.warn("loop.skills: could not update the skills block", error),
  );
  const refresh = async () => {
    try {
      if (!(await rootReady) || !root) return;
      const reply = parseReply((await spawn("list", { root })).stdout);
      if (!reply.ok) return;
      const entries = (reply.data?.skills ?? [])
        .filter((s) => s.state === "approved")
        .map((s) => ({
          slug: s.slug,
          description: s.description,
          approvedAt: Date.parse(s.approvedAt) || 0,
        }));
      holder.set(entries, { language: "ko", skillsRoot: root });
    } catch {
      // A failed refresh must not kill a turn, and the previous block stays
      // live. This is the normal state with no desktop host, so it is not
      // logged: a warning per turn is noise, not information.
    }
  };

  ctx.effect(() => () => holder.dispose());

  for (const tool of TOOLS) {
    ctx.agents.addTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      call: async (_client, context, args) => {
        await rootReady;
        if (!root) {
          return `I can't reach the skills folder (${rootFailed ?? "it did not resolve"}). Procedures need the desktop app.`;
        }
        const reply = await callTool(deps(), tool.name, args ?? {}, context ?? {});
        // A draft changes nothing an agent can see, but a decision does; refresh
        // after every call so an approval takes effect on the next turn.
        void refresh();
        return reply;
      },
    });
  }

  // The zero-skill block must be live from the very first turn, not after the
  // first draft: it is the only thing that tells an agent drafting exists.
  void refresh();

  if (ctx.settingsCards?.register) {
    try {
      const Library = LibraryCard(ctx, {
        spawn,
        root: () => root ?? "",
        parse: (promise) => promise.then((r) => parseReply(r.stdout)),
        refresh,
      });
      ctx.settingsCards.register({ id: "library", title: "Skills", component: Library });
    } catch (error) {
      // A card that will not build must not take the tools down with it.
      console.warn("loop.skills: could not register the skills library", error);
    }
  }

  // The AGENTS.md pointer tells an agent's *file* tools where the index is, for
  // the case where tools are unavailable but files are not. It is additive and
  // marked, so it is removed cleanly on unload.
  ctx.effect(() => {
    let agentsFile;
    const write = async () => {
      try {
        if (!(await rootReady) || !root) return;
        const dir = await ctx.host.resolveDirectory("~/.buzz", { create: false });
        agentsFile = `${dir}/AGENTS.md`;
        await spawn("pointer", { root, add: true, agentsFile });
      } catch {
        // No desktop host, or no AGENTS.md: the pointer is a convenience only.
      }
    };
    void write();
    return () => {
      if (!agentsFile || !root) return;
      void spawn("pointer", { root, add: false, agentsFile }).catch(() => {});
    };
  });
}
