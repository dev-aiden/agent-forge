# Changelog

## [Unreleased]

### Added
- Move old commands into skills: Claude Code custom commands (`~/.claude/commands`, `.claude/commands`) and Codex custom prompts (`~/.codex/prompts`) are listed under My skills and can become Kitroom skills. Deleting the original file is optional and happens on the next apply, with backup and undo.
- Skill fields "Only when called by name" (`disable-model-invocation`; Codex: `allow_implicit_invocation: false`) and "Argument hint" (`argument-hint`, Claude Code).
- Overview shows commands and prompts for Claude Code and Codex.
- Claude settings → Permissions: manage Claude Code's allow / ask / deny rules in `settings.json` (global and project), import the current ones, add rules from templates. Only the permission lists change; other settings and secrets (masked in the preview) are kept. Claude Code only for now.

## [0.1.2]

### Added
- Install and update on macOS with Homebrew: `brew install --cask dev-aiden/tap/kitroom`.
- Copilot CLI: personal instructions (`~/.copilot/instructions/`), project `.mcp.json` and `.github/copilot/settings.local.json`.
- Antigravity CLI: all four global rule files (`GEMINI.md` / `AGENTS.md` in `~/.gemini` and `~/.gemini/config`), skills in `~/.gemini/config/skills` and `~/.gemini/skills`, project `.agents/AGENTS.md` / `.agents/GEMINI.md`, and the CLI settings file.

### Changed
- Copilot CLI, Antigravity CLI and Codex agent locations are now checked against each tool's official docs, so the "unverified path" badge is gone.
- Never read: Copilot `providers.json` (stores API keys in plain text) and Antigravity `mcp_oauth_tokens.json`.

## [0.1.1]

### Changed
- Renamed from **Agent Forge** to **Kitroom**; the repository moved to `github.com/dev-aiden/kitroom`.
- New app icon: a kit case holding agents, skills, rules and MCP servers.
- On first launch, the app folder `~/.agent-forge` is moved to `~/.kitroom`, so agents, skills, settings and undo history carry over.

If you installed Agent Forge 0.1.0, it will not tell you about this release: download Kitroom from the release page and delete the old "Agent Forge" app.

## [0.1.0]

First public release.

### Added
- Create agents, skills, top-level rules (`CLAUDE.md` / `AGENTS.md`) and MCP servers once and apply them to Claude Code and Codex CLI, globally or for one project.
- Preview every change as a diff before writing; originals are backed up to `~/.kitroom/backups/` and every apply can be undone.
- Import existing agents, skills, rules and MCP servers, keeping tool-specific fields and bundled skill files.
- Starter templates: 6 agents, 4 skills, 4 rule sections, 3 MCP servers.
- Overview of Claude Code, Codex CLI, Copilot CLI and Antigravity CLI configuration with secrets masked (Copilot and Antigravity are view-only).
- Terminal tabs for the installed CLIs and your shell (search, links, font size, run again).
- Korean and English UI, light and dark themes.
- Optional check for new versions on launch (GitHub releases only; can be turned off).
- Installers for macOS (Apple Silicon and Intel), Windows and Linux. Not code-signed yet.
