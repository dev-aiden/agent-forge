import { test } from "node:test";
import assert from "node:assert/strict";
import { MASK, maskMcpServer, type McpServer } from "./index";

const base: McpServer = {
  kind: "mcp",
  id: "claude:/x#s",
  name: "s",
  transport: "stdio",
  enabled: true,
  extra: {},
  source: { tool: "claude", scope: "global", path: "/x", format: "json", verified: true },
};

test("masks env and header values but keeps key names", () => {
  const m = maskMcpServer({ ...base, env: { TOKEN: "abc" }, headers: { Authorization: "Bearer abc" } });
  assert.deepEqual(m.env, { TOKEN: MASK });
  assert.deepEqual(m.headers, { Authorization: MASK });
});

test("masks secret-looking CLI args", () => {
  const m = maskMcpServer({
    ...base,
    args: ["-y", "server", "--api-key", "abc", "--token=def", "--port", "3000", "--access-token", "--verbose"],
  });
  assert.deepEqual(m.args, ["-y", "server", "--api-key", MASK, `--token=${MASK}`, "--port", "3000", "--access-token", "--verbose"]);
});

test("masks URL credentials and query values", () => {
  const m = maskMcpServer({ ...base, transport: "http", url: "https://user:pw@mcp.example.invalid/mcp?key=abc&x=1" });
  assert.ok(!m.url!.includes("abc"));
  assert.ok(!m.url!.includes("pw"));
  assert.ok(m.url!.startsWith("https://"));
  assert.ok(m.url!.includes("mcp.example.invalid/mcp"));
});

test("masks string values in extra, keeps numbers and booleans", () => {
  const m = maskMcpServer({ ...base, extra: { bearer_token: "abc", timeout: 20, trust: true } });
  assert.deepEqual(m.extra, { bearer_token: MASK, timeout: 20, trust: true });
});

test("does not mutate the original", () => {
  const original = { ...base, env: { TOKEN: "abc" } };
  maskMcpServer(original);
  assert.equal(original.env.TOKEN, "abc");
});
