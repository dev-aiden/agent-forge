# Gallery

Starter templates shown in Kitroom under **Templates**. They are bundled
into the app at build time; the app never downloads templates.

| Folder | File | Becomes |
|---|---|---|
| `agents/` | `<name>.md` | an agent (frontmatter: `name`, `description`, optional `model`, `tools`) |
| `skills/` | `<name>.md` | a skill (frontmatter: `name`, `description`) |
| `rules/` | `<id>.md` | a section appended to the top-level rules |
| `mcp/` | `<name>.json` | an MCP server (`{ title, summary, server }`) |

Every template needs `title.en`, `title.ko`, `summary.en` and `summary.ko`.
Frontmatter is flat `key: value` lines only (no YAML lists or quotes).
The `name` must equal the file name. Instructions are written in English.

Never put secrets in templates. MCP `env` / `headers` values must be
`${VAR}` references. `npm test` checks all of this.
