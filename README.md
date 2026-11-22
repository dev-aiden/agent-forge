# Agent Forge

A free, open-source desktop app (macOS · Windows · Linux) that lets you create agents, skills, rules and MCP settings in one place, apply them to every AI coding CLI you already use — Claude Code, Codex CLI, Copilot CLI and Antigravity CLI — and run those CLIs side by side in one window.

Agent Forge never calls an AI API itself. Each official CLI runs on your own subscription. Your logins and tokens are never read or touched.

> Status: early development (week 1 — research and skeleton). Nothing is usable yet.

## Using the app

- Korean user guide for testers: [docs/ko/사용법.md](docs/ko/사용법.md)

## Development

Requires Node.js 22+.

```sh
npm install
npm run scan        # read-only: list config files of the four CLIs on this machine
npm test            # scanner tests (temp-dir fixtures)
npm run dev         # start the desktop app in dev mode
npm run smoke       # build and check the app window starts
```

Package an installer: `npm run dist:mac | dist:win | dist:linux -w @agent-forge/desktop`.

## License

MIT
