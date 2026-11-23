import assert from "node:assert/strict";
import { test } from "node:test";

import { isNewer, isReleaseUrl } from "./release";

test("isNewer compares plain x.y.z versions", () => {
  assert.ok(isNewer("0.0.1", "v0.1.0"));
  assert.ok(isNewer("0.9.9", "1.0.0"));
  assert.ok(isNewer("1.2.3", "v1.2.10"));
  assert.ok(!isNewer("1.2.3", "v1.2.3"));
  assert.ok(!isNewer("1.2.3", "v1.2.2"));
  assert.ok(!isNewer("1.2.3", "v1.3.0-beta.1"));
  assert.ok(!isNewer("1.2.3", "latest"));
});

test("isReleaseUrl only accepts this repository's release pages", () => {
  assert.ok(isReleaseUrl("https://github.com/dev-aiden/kitroom/releases/tag/v0.1.0"));
  assert.ok(!isReleaseUrl("https://github.com/someone/else/releases/tag/v1"));
  assert.ok(!isReleaseUrl("https://evil.example/https://github.com/dev-aiden/kitroom/releases/"));
  assert.ok(!isReleaseUrl(42));
});
