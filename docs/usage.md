# Kitroom user guide

Kitroom is a free, open-source desktop app (macOS · Windows · Linux) for creating **agents, skills, rules and MCP servers** for AI coding CLIs such as Claude Code and Codex CLI in one place, and applying them to several tools at once.

- Write a "code reviewer" agent once; Kitroom writes it in each selected tool's format.
- See every rule, agent, skill and MCP server your tools currently use, in one overview.
- Run the installed CLIs side by side in terminal tabs inside the app.

> 한국어: [docs/ko/사용법.md](ko/사용법.md)

## Contents

1. [Requirements](#1-requirements)
2. [Install](#2-install)
3. [Get started in 5 minutes](#3-get-started-in-5-minutes)
4. [The window](#4-the-window)
5. [The basic flow](#5-the-basic-flow-save--preview--apply--undo)
6. [Screens](#6-screens)
7. [What is supported](#7-what-is-supported)
8. [When something goes wrong](#8-when-something-goes-wrong)
9. [Known limitations](#9-known-limitations)
10. [Questions and ideas](#10-questions-and-ideas)

### Safety

| Concern | What actually happens |
|---|---|
| Does it use my AI subscription or API key? | **No.** The app never calls an AI API and has no API key field. Each CLI keeps running on your own subscription. |
| Does it take my login? | **No.** CLI login, token and auth files are never read or copied. |
| Does it send anything over the internet? | **No.** The only network request is the "check for new versions" lookup (asks GitHub for the latest version number), which you can turn off in Settings. No accounts, no servers, no usage statistics. |
| What if it breaks my config? | Before writing, it shows **exactly what will change**, backs up the originals, and lets you **undo** at any time. |
| What if I edit a file after previewing? | Applying re-checks every file and **refuses** if anything changed since the preview. Undo never overwrites files you edited yourself. |

---

## 1. Requirements

- macOS (Apple Silicon or Intel), Windows 10/11 (64-bit) or Linux (x64)
- At least one AI coding CLI installed and signed in (the app opens without one, but there is little to see):
  - **Claude Code** (`claude`)
  - **Codex CLI** (`codex`)
  - GitHub Copilot CLI (`copilot`), Antigravity CLI (`agy`) — view only (see section 7)
- MCP templates need Node.js (`npx`).

---

## 2. Install

Download the file for your OS from [GitHub Releases](https://github.com/dev-aiden/kitroom/releases/latest).

| OS | File |
|---|---|
| macOS (Apple Silicon, M1 or later) | `kitroom-<version>-mac-arm64.dmg` |
| macOS (Intel) | `kitroom-<version>-mac-x64.dmg` |
| Windows | `kitroom-<version>-win-x64.exe` |
| Linux | `kitroom-<version>-linux-x86_64.AppImage` |

> The app is not code-signed yet, so **your OS warns you the first time you open it.** Here is how to get past it.

### macOS

**With Homebrew** (installs and updates in one command):

```bash
brew install --cask dev-aiden/tap/kitroom   # install
brew upgrade --cask kitroom                 # update later
```

The warning in step 2 below can still appear, because the app is not code-signed yet.

**Without Homebrew:**

1. Open the `.dmg` and drag **Kitroom** into `Applications`.
2. If macOS says the app **"is damaged and can't be opened"** or comes from an **unidentified developer**, run this once in Terminal:
   ```bash
   xattr -cr "/Applications/Kitroom.app"
   ```
   Then open it again. (This removes the "downloaded from the internet" quarantine flag.)
3. Or use **Open Anyway** at the bottom of `System Settings → Privacy & Security`.

> Not sure which Mac you have? ` menu → About This Mac`: "Apple M…" means arm64, "Intel" means x64.

### Windows

1. Run the `.exe`.
2. If **"Windows protected your PC"** appears, click **More info → Run anyway**.
3. Choose a folder and install.

### Linux

```bash
chmod +x kitroom-*.AppImage
./kitroom-*.AppImage
```

---

## 3. Get started in 5 minutes

If you already use Claude Code or Codex:

1. Check what you have in **Overview**.
2. Click **Agents → `Import`**, **Skills → `Import`**, **Rules → `Start with my current rules`** and **MCP → `Import my current servers`**. What you already use now appears in the app.
3. Click `Preview & apply` on any of those screens. **"Everything is already up to date"** means you are ready. (Importing alone never changes your tool files.)
4. On Agents: **`Templates` → Code reviewer → `Use this template`** → `Create agent` → `Preview & apply` → `Apply 2 change(s)`.
5. Open **Terminal → `+ Claude Code`** and type `/agents`: `code-reviewer` is there. Codex can use the same agent.
6. Changed your mind? **Apply history → `Undo`** at the bottom left.

New to these tools? Skip step 2 and start from a template.

---

## 4. The window

```
Kitroom [Overview|Agents|Skills|Rules|MCP|Claude settings|Terminal]  Project: None (global only) [Choose…]   ● Read  [Refresh] [Settings]
```

| Menu | What it does |
|---|---|
| **Overview** | Shows each tool's current rules, agents, skills and MCP servers. Read-only. |
| **Agents** | Create agents (subagents) and apply them to Claude Code and Codex. |
| **Skills** | Create skills (`SKILL.md`) and apply them. |
| **Rules** | Edit the top-level instructions every tool reads (`CLAUDE.md`, `AGENTS.md`) in one place. |
| **MCP** | Manage one MCP server list and apply it. |
| **Claude settings** | Claude Code `settings.json`: permission rules (allow / ask / deny) and hooks. Shown when Claude Code is detected. |
| **Terminal** | Run installed AI CLIs or your shell in tabs. |
| **Project [Choose…]** | Pick a project folder to also see its settings and to write to that project only. |
| **Settings** | Language, theme, which tools to show, and the new-version check. |

The green dot (●) means config files are **being watched**: changes made elsewhere show up automatically.

---

## 5. The basic flow: save → preview → apply → undo

Agents, Skills, Rules and MCP all work the same way.

1. **Save** — fill in the form and click `Create agent` (or `Save changes`).
   This only saves inside Kitroom (`~/.kitroom`). **Your tool configs are unchanged.**
2. **Preview & apply** — the button at the top right opens a review window:
   - which files will be `created` / `modified` / `deleted`;
   - the exact lines that change in each file (green = added, red = removed);
   - warnings to read first (yellow).
3. **Apply N change(s)** — when it looks right. Originals are backed up before anything is written.
4. **Undo** — `Apply history` at the bottom left; `Undo` restores everything from that apply.

> Secrets (tokens, passwords, …) are always shown as `••••` on screen and in the preview.

### Where to apply: global or this project

The **Apply to** bar above Agents, Skills, Rules and MCP chooses the target.

| Choice | Writes to | Use it for |
|---|---|---|
| **Global (~)** | Your user config: `~/.claude`, `~/.codex`, … | Things you want in every folder |
| **This project** | The selected project folder (`.claude/`, `.codex/`, `.agents/`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`) | Things for that project only |

- `This project` is available after choosing a folder with **Project [Choose…]**.
- Global and project items are **separate lists**.
- Project originals stay on your computer (`~/.kitroom/projects/`); only the files the tools read are written into the project.

---

## 6. Screens

### 6-1. Overview

- Pick a tool tab (Claude Code, Codex CLI, …) to see its **rules / agents / skills / commands / MCP servers**. Commands are Claude Code custom commands (`commands/*.md`) and Codex custom prompts (`~/.codex/prompts/*.md`); see [Move old commands into skills](#move-old-commands-into-skills).
- Click an item to see its content and file location.
- Badges:
  - `global` / `project` / `local` — the scope of the setting;
  - `unverified path` — a location not confirmed by the tool's official documentation (at the moment only `~/.claude/commands`: the docs name only the project folder `.claude/commands`);
  - `claude.ai` — skills synced from claude.ai (never touched by the app).
- Type in the filter box to search by name or description.

### 6-2. Start from a template

`Templates` above the list (or `Start from a template` when the list is empty) offers ready-made examples.

| Screen | Templates |
|---|---|
| Agents | Code reviewer, Test writer, Debugger, Security reviewer, Refactorer, Docs writer |
| Skills | Commit message, Pull request description, Changelog entry, Explain code |
| Rules (`Add section`) | Reply in Korean, Small focused commits, Verify before saying done, Ask before risky commands |
| MCP | Playwright (browser), Context7 (library docs), Memory |

- A template **only fills in the form**. You still save and apply yourself.
- Instructions are in English (models follow them most reliably). Edit them freely.
- If the name is taken, a number is added (`code-reviewer-2`).
- Rule sections are **appended** to your rules, never replacing them, and are not added twice.
- MCP templates need Node.js; the first run downloads the package.

### 6-3. Agents

> **If Claude Code or Codex already has agents, click `Import` first.** Creating an agent with the same name as one the app does not know about causes a conflict when applying.
> - Imported agents appear in the list and can be edited and applied from then on.
> - Right after importing, `Preview & apply` should say "Everything is already up to date". If it shows changes, please [open an issue](https://github.com/dev-aiden/kitroom/issues).
> - Settings the form does not show (Claude Code `color`, `permissionMode`; Codex `model`, `sandbox_mode`, …) appear under "Other settings" and are kept when you save.
> - If both tools have the same name with different content, Claude Code's version is imported and you are told.
> - Agents whose file name differs from their `name` are not imported (applying would create a duplicate). Rename the file to match, then import again.

1. Click `New` (or pick from `Templates`).
2. Fill in:
   - **Name**: letters, digits, `-`, `_` (e.g. `code-reviewer`). Used as the file name.
   - **Description**: *when* the tool should use this agent.
   - **Apply to**: Claude Code and/or Codex CLI.
   - **Model / Tools**: Claude Code only. Optional.
   - **Instructions**: the agent's system prompt.
3. `Create agent` → `Preview & apply` → `Apply N change(s)`

Output files:

| | Global | Project |
|---|---|---|
| Claude Code | `~/.claude/agents/<name>.md` | `<project>/.claude/agents/<name>.md` |
| Codex CLI | `~/.codex/agents/<name>.toml` | `<project>/.codex/agents/<name>.toml` |

To change one, select it, edit, `Save changes`, apply again. `Delete` and then apply removes it from the tools too.

### 6-4. Skills

Same as agents; the body goes into the `SKILL.md` field. Two more fields:

- **Only when called by name** — the tool does not pick the skill on its own; it runs only when you type `/name` (Claude Code) or call it by name (Codex). Written as `disable-model-invocation: true` for Claude Code and as `policy.allow_implicit_invocation: false` in the skill's `agents/openai.yaml` for Codex.
- **Argument hint** — Claude Code only. Shown when typing `/name`, e.g. `[issue-number]` (`argument-hint`).

| | Global | Project |
|---|---|---|
| Claude Code | `~/.claude/skills/<name>/SKILL.md` | `<project>/.claude/skills/<name>/SKILL.md` |
| Codex CLI | `~/.agents/skills/<name>/SKILL.md` | `<project>/.agents/skills/<name>/SKILL.md` |

> The name `synced` is reserved by Claude.

`Import` also brings in existing skills with their other files (`scripts/`, …), which are kept as they are. These are skipped, with the reason shown:
- skills containing non-text files such as images;
- skills whose folder name differs from their `name` (applying would create a duplicate);
- skills with settings Kitroom cannot keep yet (e.g. `license` on a Codex skill, unknown frontmatter keys);
- skills containing symbolic links, or more than 200 files / 20 MB;
- Codex skills with UI settings (`agents/openai.yaml`);
- skills in the old location `~/.codex/skills`;
- skills synced from claude.ai (`~/.claude/skills/synced`).

#### Move old commands into skills

Claude Code has merged custom commands into skills, and Codex has deprecated custom prompts in favor of skills. The **Old commands** list under My skills shows the commands of the current scope:

| | Global | Project |
|---|---|---|
| Claude Code | `~/.claude/commands/*.md` | `<project>/.claude/commands/*.md` |
| Codex CLI | `~/.codex/prompts/*.md` | — |

`Move to skill` creates a Kitroom skill with the same name, settings and content, for the same tool. A Codex prompt becomes a skill that runs only when called by name, as before. Nothing in the tools changes until you preview and apply.

- **Delete the original file on the next apply** (off by default): the next preview lists the command file as deleted; it is backed up and `Undo` restores it. The file is kept if you edited it after moving, or if the skill was deleted or no longer targets that tool. A skill takes priority over a command with the same name, so keeping the file is harmless in Claude Code.
- Prompts that use argument placeholders (`$1`, `$ARGUMENTS`, `$NAME`) get a warning: Codex skills do not fill them in, so check the content after moving.
- These are not moved, with the reason shown: commands in sub-folders (`git/commit.md`) or with names not allowed for a skill, commands with a skill of the same name, and commands with frontmatter a skill cannot keep.

### 6-5. Rules (top-level instructions)

The instructions every tool reads at the start of a session: `CLAUDE.md` for Claude Code, `AGENTS.md` for Codex.

1. Click `Start with my current rules` the first time to bring in what you have.
   - If the two tools differ, Claude Code's is used and you are told.
2. Edit, `Save changes`, `Preview & apply`. The **same text** is written to every selected tool.
3. `Add section` appends a common rule (e.g. "Reply in Korean") to the end.
4. `Stop managing` hands the rules back to you (tool files stay as they are).

> If Codex has an `AGENTS.override.md`, Codex reads that instead of `AGENTS.md`. The preview warns you.

### 6-6. MCP servers

MCP servers give AI tools extra capabilities (browser, databases, docs, …).

1. **Always** click `Import my current servers` first.
   Applying replaces each tool's **whole** MCP list with the app's list, so import what you already use.
2. `New` adds a server:
   - **Transport**: `stdio` (runs a command) or `http`/`sse` (URL)
   - stdio: **command** (e.g. `npx`), **arguments** (one per line), **environment** (`KEY=value`)
   - http: **URL**, **headers** (`Name=value`)
3. `Add server` → `Preview & apply`

How it is applied:

| | Global | Project |
|---|---|---|
| Claude Code | The official `claude mcp add-json … -s user` command (the config file is never edited directly) | Written to `<project>/.mcp.json` |
| Codex CLI | Only the MCP part of `~/.codex/config.toml` changes; other settings stay | `<project>/.codex/config.toml` |

Good to know:
- Secrets show as `••••`. **Saving without touching them keeps the original values.** Type a new value to change one.
- If a tool has a server the app does not list, the preview warns that applying would remove it. Click `Import` at the top left of the MCP screen.
- For **projects**:
  - Claude Code asks for approval the first time it uses a server from `.mcp.json`.
  - Codex reads `.codex/config.toml` only in trusted projects.
  - `.mcp.json` is usually committed to git: use environment references like `${GITHUB_TOKEN}` instead of literal tokens. The preview warns about literal values.
- Codex-only settings such as `startup_timeout_sec` or `enabled = false` appear under `Other Codex settings` and are kept.

> ⚠️ **If you started the app from inside Claude Code** (e.g. `npm run dev` in a Claude Code terminal), global Claude Code MCP changes are blocked, because Claude Code refuses registrations from inside its own session. Open the app normally instead.

### 6-7. Claude settings (permissions, hooks)

Claude Code's permission rules in `settings.json`: **Allow** runs a tool without asking, **Ask** always asks, **Deny** blocks it (Deny wins over Ask, Ask over Allow).

| | Global | Project |
|---|---|---|
| Claude Code | `~/.claude/settings.json` | `<project>/.claude/settings.json` (shared with your team) |

1. `Start with my current permissions` imports the lists from `settings.json`.
2. Add or remove rules in the three lists, or use `Add from template` (block destructive commands, protect secret files, ask before pushing, allow read-only git). Templates only add rules; a rule already in another list stays there.
3. `Save changes`, then `Preview & apply`.

- Write rules as in `settings.json`: `Tool` or `Tool(pattern)`, e.g. `Bash(npm test:*)`, `Read(./.env)`, `WebFetch(domain:github.com)`, `mcp__github`.
- Only the `allow` / `ask` / `deny` lists change. Every other setting in the file (model, env, hooks, `defaultMode`, …) and the file's formatting stay as they are. Values in `env` and other secret-looking values are hidden in the preview.
- Kitroom replaces all rules of each tool it manages (Bash, Read, …) and keeps rules for other tools. If `settings.json` has a rule for a managed tool that is not in Kitroom's lists (e.g. Claude Code added it after "don't ask again"), the preview warns before it is removed.
- Import leaves some rules in `settings.json` untouched, with the reason shown: rules written in a form Kitroom would rewrite (e.g. `Bash(*)` is written as `Bash`, `Write(…)` as `Edit(…)`), rules in more than one list, and every other rule for the same tool.
- `settings.local.json` and managed (organization) settings are never written.
- Claude Code only for now. Codex permissions work differently (sandbox profiles) and are not written yet.

#### Hooks

Hooks are commands Claude Code runs on its own at certain moments: `PreToolUse` (before a tool runs; exit code 2 blocks it), `PostToolUse` (after it succeeds), `UserPromptSubmit`, `Stop` (when Claude finishes), `Notification`, `SessionStart`, and more. They are stored in the same `settings.json`.

1. Open **Claude settings → Hooks** and choose `Start with my current hooks`. Hooks come in exactly as they are.
2. Each event lists its groups: **Tools** (the matcher, e.g. `Bash` or `Edit|Write`; empty = all tools) and the commands with an optional timeout in seconds. Add a hook with the event picker, or use `Add from template` (format files with Prettier, block `rm -rf`, notify when done on macOS / Linux). Template descriptions say what the command needs (e.g. `jq`).
3. `Save changes`, then `Preview & apply`. The preview lists every new or changed command Claude Code will run.

- Hooks run commands without asking, with your permissions. Only add commands you understand. In a project, `.claude/settings.json` is usually committed, so teammates run them too; the preview says so.
- Commands are written exactly as typed. Kitroom does not rewrite them.
- Only command hooks can be edited. Other kinds (`prompt`, `agent`, `http`) and extra fields are kept exactly as they are and can be deleted. Their secret values (headers, tokens in URLs) are hidden in the app.
- Only the `hooks` key changes; `disableAllHooks` and other settings stay as they are.
- Claude Code only for now. Codex hooks work differently and are not written yet.

### 6-8. Terminal

1. Click `+ Claude Code`, `+ Codex CLI`, `+ Shell`, … under `New tab`.
   - A greyed-out button means that CLI was not found on your PATH.
2. Switch tabs at the top; close with `×`. Tabs keep running while you use other screens.
3. With a project selected, tabs start in that folder (shown as `Runs in …`).

Shortcuts (⌘ on macOS, Ctrl on Windows/Linux):

| Keys | Action |
|---|---|
| ⌘/Ctrl + F | Find in output (Enter next, Shift+Enter previous, Esc close) |
| ⌘/Ctrl + `+` / `-` | Larger / smaller text (remembered) |
| ⌘/Ctrl + 0 | Default text size |
| Ctrl + Shift + C / V | (Windows/Linux) Copy / paste. Plain Ctrl+C interrupts the program. |

- Click `https://…` links in the output to open them in your browser.
- When a program exits, a `Run again` button appears.

### 6-9. Settings

- **Language**: system / 한국어 / English
- **Theme**: system / light / dark
- **Tools**: turned-off tools are hidden in Overview and Terminal.
- **Check for new versions on launch**: asks GitHub for the latest release and shows a banner if there is a newer one. Nothing is installed automatically. Turn it off and the app makes no network requests at all.
- Settings live in `~/.kitroom/settings.json`.

---

## 7. What is supported

| Tool | View | Write |
|---|---|---|
| Claude Code | ✅ | ✅ Agents, skills, rules, MCP, permissions, hooks (global and project) |
| Codex CLI | ✅ | ✅ Agents, skills, rules, MCP (global and project) |
| Copilot CLI | ✅ | ❌ |
| Antigravity CLI | ✅ | ❌ |

---

## 8. When something goes wrong

### Undo in the app
Most problems are solved with `Apply history → Undo`.
Files you edited yourself after applying are left alone (the notice tells you which).

### Restore by hand
If the app will not open:

- Backups:
  - global: `~/.kitroom/backups/<date-time-…>/`
  - project: `~/.kitroom/projects/<project-…>/backups/<date-time-…>/`
- `manifest.json` in that folder lists each **original path (`path`)** and its **backup file (`backup`, e.g. `000.bak`)**.
  Copy the `.bak` file back to the original path. `backup: null` means the app created that file: delete it.
- Claude Code global MCP servers: `claude mcp list` / `claude mcp remove <name> -s user`.

> Backups may contain secrets such as MCP tokens, so they are readable only by you. Do not share them.

### Uninstall completely
1. Remove the app (macOS: move it to the Trash / Windows: Settings → Apps).
2. Delete the app data: the `~/.kitroom` folder.
   (Tool config files you applied stay. Undo first if you want them back.)

### Common messages

| Message | Meaning / fix |
|---|---|
| "inside a Claude Code session…" (MCP apply blocked) | The app was started from inside Claude Code. Open it normally. |
| "changed since the preview. Preview again" | A file changed after the preview. Preview again — this is a safety check. |
| A greyed-out terminal button | The CLI was not found. Check `which claude` (Windows: `where claude`) in a normal terminal. |
| "This file was not created by Kitroom" | A file with the same name exists and will be replaced. The original is backed up. |

---

## 9. Known limitations

- Not code-signed yet, so the OS warns on install (section 2). To update, download the new version when the banner tells you (or run `brew upgrade --cask kitroom`).
- Copilot CLI and Antigravity CLI are **view only**. Their file locations follow the official docs but have not been tried on a real install.
- Claude Code's `local` MCP scope (one project, not shared) is not supported yet.
- Skills containing non-text files (images, …) are not imported.

---

## 10. Questions and ideas

Report bugs and ideas in [GitHub Issues](https://github.com/dev-aiden/kitroom/issues) (forms are provided).
Report security problems privately through [security advisories](https://github.com/dev-aiden/kitroom/security/advisories/new), not as a public issue.

> ⚠️ Before posting screenshots or files, **make sure no tokens, passwords or emails are visible.**
> Never attach `~/.kitroom/backups`, `~/.claude.json`, `auth.json` or similar files.
