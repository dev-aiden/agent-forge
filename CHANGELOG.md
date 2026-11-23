# Changelog

## [0.1.0]

First public release.

### Added
- Create agents, skills, top-level rules (`CLAUDE.md` / `AGENTS.md`) and MCP servers once and apply them to Claude Code and Codex CLI, globally or for one project.
- Preview every change as a diff before writing; originals are backed up to `~/.agent-forge/backups/` and every apply can be undone.
- Import existing agents, skills, rules and MCP servers, keeping tool-specific fields and bundled skill files.
- Starter templates: 6 agents, 4 skills, 4 rule sections, 3 MCP servers.
- Overview of Claude Code, Codex CLI, Copilot CLI and Antigravity CLI configuration with secrets masked (Copilot and Antigravity are view-only).
- Terminal tabs for the installed CLIs and your shell (search, links, font size, run again).
- Korean and English UI, light and dark themes.
- Optional check for new versions on launch (GitHub releases only; can be turned off).
- Installers for macOS (Apple Silicon and Intel), Windows and Linux. Not code-signed yet.
