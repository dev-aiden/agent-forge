// Claude Code hooks in settings.json: import, edit, apply, undo. Runs in a fake HOME.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ManagedHooks } from "@kitroom/model";
import type { PathContext } from "../types";
import { hooksPath, importHooks, readManagedHooks, saveManagedHooks, unmanageHooks } from "./claude-hooks";
import { displayChangeSet } from "./display";
import { nodeWorkerRunner } from "./node-runner";
import { saveManagedPermissions } from "./permissions";
import { apply, preview, undo, type PipelineRunners } from "./pipeline";

let root: string, home: string, ctx: PathContext, settings: string;
const runners: PipelineRunners = { worker: nodeWorkerRunner, claude: null };

async function put(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

const USER_SETTINGS = `{
  "model": "opus",
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write", "hooks": [ { "type": "command", "command": "./scripts/format.sh", "timeout": 30 } ] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [ { "type": "http", "url": "https://hooks.example.com/x?token=abc", "headers": { "Authorization": "Bearer s3cret" } } ] },
      { "hooks": [ { "type": "command", "command": "say done", "statusMessage": "Notifying" } ] }
    ]
  },
  "disableAllHooks": false
}
`;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "kitroom-hooks-"));
  home = join(root, "home");
  ctx = { home, project: "", env: { KITROOM_HOME: join(root, "forge") } };
  settings = join(home, ".claude/settings.json");
});

afterEach(() => rm(root, { recursive: true, force: true }));

const pending = async () => (await preview(ctx, runners)).changes.filter((c) => c.action !== "unchanged");

test("import keeps hooks exactly; applying right after changes nothing", async () => {
  await put(settings, USER_SETTINGS);
  assert.deepEqual(await importHooks(ctx), { events: 2, hooks: 3 });
  assert.equal((await stat(hooksPath(ctx))).mode & 0o777, 0o600);
  assert.deepEqual(await pending(), []);
});

test("the app sees masked extras; saving what it sent keeps the secrets and changes nothing", async () => {
  await put(settings, USER_SETTINGS);
  await importHooks(ctx);
  const view = (await readManagedHooks(ctx))!;
  const http = view.Stop![0]!.hooks[0]!;
  assert.equal(http.type, "http");
  assert.doesNotMatch(JSON.stringify(view), /s3cret|token=abc/);
  assert.deepEqual(view.Stop![1]!.hooks[0]!.extra, { statusMessage: "Notifying" });

  // The renderer sends back what it got (masked extras): stored values are kept.
  await saveManagedHooks(ctx, JSON.parse(JSON.stringify(view)) as ManagedHooks);
  assert.deepEqual(await pending(), []);
  assert.match(await readFile(hooksPath(ctx), "utf8"), /Bearer s3cret/);
});

test("editing changes only `hooks`; commands are written as typed; preview warns about new commands", async () => {
  await put(settings, USER_SETTINGS);
  await importHooks(ctx);
  const view = (await readManagedHooks(ctx))!;
  view.PostToolUse![0]!.hooks[0]!.command = "./scripts/format.sh --quiet";
  view.PreToolUse = [{ matcher: "Bash", hooks: [{ type: "command", command: "./scripts/block-rm.sh" }] }];
  delete view.Stop;
  await saveManagedHooks(ctx, view);

  const set = await preview(ctx, runners);
  const [c] = set.changes.filter((x) => x.action !== "unchanged");
  assert.equal(c!.path, settings);
  const after = JSON.parse(c!.after!);
  assert.equal(after.model, "opus");
  assert.equal(after.disableAllHooks, false);
  assert.deepEqual(after.hooks, {
    PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "./scripts/format.sh --quiet", timeout: 30 }] }],
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./scripts/block-rm.sh" }] }],
  });
  assert.deepEqual(set.warnings, [
    {
      kind: "hook-commands",
      project: false,
      commands: [
        { event: "PostToolUse", command: "./scripts/format.sh --quiet" },
        { event: "PreToolUse", command: "./scripts/block-rm.sh" },
      ],
    },
  ]);

  const m = await apply(ctx, set, runners);
  assert.deepEqual(await pending(), []);
  await undo(ctx, m.id, runners);
  assert.equal(await readFile(settings, "utf8"), USER_SETTINGS);
});

test("permissions and hooks go into settings.json together; secrets hidden in the preview", async () => {
  await put(settings, USER_SETTINGS);
  await importHooks(ctx);
  await saveManagedPermissions(ctx, { allow: [], ask: [], deny: ["Bash(rm -rf:*)"] });
  const set = await preview(ctx, runners);
  const changes = set.changes.filter((x) => x.action !== "unchanged");
  assert.equal(changes.length, 1);
  const after = JSON.parse(changes[0]!.after!);
  assert.deepEqual(after.permissions, { deny: ["Bash(rm -rf:*)"] });
  assert.equal(after.hooks.Stop.length, 2);
  const shown = displayChangeSet(set).changes[0]!;
  assert.doesNotMatch(`${shown.before}${shown.after}`, /s3cret|token=abc/);
});

test("project scope warns that teammates run the commands; empty hooks create no file", async () => {
  assert.deepEqual(await importHooks(ctx), { events: 0, hooks: 0 });
  assert.deepEqual(await pending(), []);

  const project = join(home, "work", "app");
  await mkdir(project, { recursive: true });
  ctx = { ...ctx, project };
  await saveManagedHooks(ctx, { Stop: [{ matcher: "", hooks: [{ type: "command", command: "say done" }] }] });
  const set = await preview(ctx, runners);
  assert.equal(set.changes[0]!.action, "create");
  assert.deepEqual(JSON.parse(set.changes[0]!.after!), { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } });
  assert.deepEqual(set.warnings, [{ kind: "hook-commands", project: true, commands: [{ event: "Stop", command: "say done" }] }]);
});

test("rejects hooks the app cannot write", async () => {
  const cmd = (command: string, timeout?: number) => ({ Stop: [{ matcher: "", hooks: [{ type: "command", command, timeout }] }] });
  await assert.rejects(saveManagedHooks(ctx, cmd("  ")), /no command/);
  await assert.rejects(saveManagedHooks(ctx, cmd("x", -1)), /positive number/);
  await assert.rejects(saveManagedHooks(ctx, { "Bad Event": [] }), /not a hook event/);
  await assert.rejects(saveManagedHooks(ctx, { Stop: [{ matcher: "", hooks: [{ type: "http" }] }] }), /Only command hooks/);
  await put(settings, `{"hooks":{"Stop":[{"command":"x"}]}}`);
  await assert.rejects(importHooks(ctx), /format/);
  await saveManagedHooks(ctx, cmd("ok", 5));
  assert.deepEqual(await readManagedHooks(ctx), { Stop: [{ matcher: "", ref: "Stop/0", hooks: [{ type: "command", command: "ok", timeout: 5, ref: "Stop/0/0" }] }] });
  await unmanageHooks(ctx);
  assert.equal(await readManagedHooks(ctx), null);
});
