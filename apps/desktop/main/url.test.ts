import { test } from "node:test";
import assert from "node:assert/strict";
import { isWebUrl } from "./url";

test("only http(s) links may be opened from the terminal", () => {
  assert.ok(isWebUrl("https://github.com/dev-aiden/agent-forge"));
  assert.ok(isWebUrl("http://localhost:3000/x"));
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "vscode://x", "ssh://host", "not a url", 42, null, `https://a/${"x".repeat(3000)}`]) {
    assert.equal(isWebUrl(bad), false, String(bad));
  }
});
