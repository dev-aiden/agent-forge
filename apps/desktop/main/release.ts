// Pure helpers for the update check (no Electron imports, so they are unit-tested).
import { RELEASES_REPO } from "../shared/api";

/** Parses "v1.2.3" / "1.2.3" (pre-release suffixes are ignored as not-newer). */
function parse(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True if `tag` is a strictly newer plain x.y.z version than `current`. */
export function isNewer(current: string, tag: string): boolean {
  const a = parse(current);
  const b = parse(tag);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i]! > a[i]!;
  return false;
}

/** Only links to this repository's release pages are shown. */
export function isReleaseUrl(url: unknown): url is string {
  return typeof url === "string" && url.startsWith(`https://github.com/${RELEASES_REPO}/releases/`) && url.length < 300;
}
