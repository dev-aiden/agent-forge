// "New version available" check. Asks GitHub for the latest published release
// of this repository; sends nothing else (no ids, no settings, no usage data).
// Pre-releases and drafts are not returned by /releases/latest.
import { net } from "electron";
import { RELEASES_REPO, type UpdateInfo } from "../shared/api";
import { isNewer, isReleaseUrl } from "./release";

const TIMEOUT_MS = 10_000;

/** Returns the newer release, or null (up to date, offline, rate-limited...). Never throws. */
export async function checkForUpdate(current: string): Promise<UpdateInfo | null> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Agent-Forge-update-check" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    if (typeof body.tag_name !== "string" || !isReleaseUrl(body.html_url)) return null;
    return isNewer(current, body.tag_name) ? { version: body.tag_name.replace(/^v/, ""), url: body.html_url } : null;
  } catch {
    return null;
  }
}
