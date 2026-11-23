<img src="apps/desktop/build/icon.png" alt="" width="96" align="left">

# Agent Forge

**One place to manage agents, skills, rules and MCP servers for your AI coding CLIs.**

Agent Forge is a free, open-source desktop app (macOS · Windows · Linux). Create an agent, skill, rule or MCP server once and apply it to Claude Code and Codex CLI in each tool's own format. See everything your tools are configured with, and run the CLIs in tabs side by side.

Agent Forge never calls an AI API. Each official CLI keeps running on your own subscription; your logins and tokens are never read.

![Overview of Claude Code and Codex CLI configuration](docs/images/overview.png)

## Features

- **Write once, apply to every tool** — agents, skills, top-level rules (`CLAUDE.md` / `AGENTS.md`) and MCP servers for Claude Code and Codex CLI, globally or for one project.
- **Preview every change** — see the exact diff before anything is written; originals are backed up and every apply can be undone.
- **Import what you already have** — existing agents, skills, rules and MCP servers come in unchanged, including tool-specific fields and bundled skill files.
- **Starter templates** — code reviewer, test writer, debugger, commit message, PR description, Playwright MCP and more.
- **Overview** — rules, agents, skills and MCP servers of Claude Code, Codex CLI, Copilot CLI and Antigravity CLI in one place, with secrets masked.
- **Terminal tabs** — run the installed CLIs and your shell inside the app.
- **Local only** — no account, no server, no telemetry. The only network request is an optional check for new versions.

| Templates | Preview before writing |
|---|---|
| ![Agent templates](docs/images/templates.png) | ![Review changes dialog with a diff](docs/images/preview.png) |

## Install

Download the latest release for your OS from **[Releases](https://github.com/dev-aiden/agent-forge/releases/latest)**:

| OS | File |
|---|---|
| macOS (Apple Silicon) | `agent-forge-<version>-mac-arm64.dmg` |
| macOS (Intel) | `agent-forge-<version>-mac-x64.dmg` |
| Windows 10/11 | `agent-forge-<version>-win-x64.exe` |
| Linux (x64) | `agent-forge-<version>-linux-x86_64.AppImage` |

The app is not code-signed yet. On macOS, if it says the app "is damaged", run `xattr -cr "/Applications/Agent Forge.app"` once; on Windows choose **More info → Run anyway**. Details: [user guide](docs/usage.md#2-install).

## Getting started

1. Open **Agents**, **Skills**, **Rules** and **MCP** and import what you already use.
2. Pick a template or create something new, then **Preview & apply**.
3. Open a **Terminal** tab with Claude Code or Codex and use it.

Full guide: **[English](docs/usage.md)** · **[한국어](docs/ko/사용법.md)**

## Supported tools

| Tool | View | Write |
|---|---|---|
| Claude Code | ✅ | ✅ agents, skills, rules, MCP |
| Codex CLI | ✅ | ✅ agents, skills, rules, MCP |
| GitHub Copilot CLI | ✅ (paths unverified) | — |
| Antigravity CLI | ✅ (paths unverified) | — |

## Privacy and safety

- No AI API calls, no API key field.
- CLI login, token and auth files are never read, copied or sent.
- Every write shows a diff first and is backed up to `~/.agent-forge/backups/`; undo is always available.
- Secrets in MCP settings are masked in the UI.
- Network: only `GET https://api.github.com/repos/dev-aiden/agent-forge/releases/latest` on launch, which can be turned off in Settings.

Found a security problem? See [SECURITY.md](SECURITY.md).

## Development

Requires Node.js 22+.

```sh
npm install
npm run dev         # start the desktop app in dev mode
npm test            # unit tests (temp-dir fixtures, gallery checks)
npm run typecheck
npm run scan        # read-only: list config files of the four CLIs on this machine
npm run smoke       # build and check that the app starts
```

Package an installer: `npm run dist:mac | dist:win | dist:linux -w @agent-forge/desktop`.

Project layout:

- `apps/desktop` — Electron app (main process, preload, React renderer)
- `packages/model` — shared data model for agents, skills, rules and MCP servers
- `packages/adapters` — per-tool readers and the write pipeline (uses [rulesync](https://github.com/dyoshikawa/rulesync) in an isolated process)
- `gallery/` — starter templates ([format](gallery/README.md); contributions welcome)

## License

[MIT](LICENSE)
