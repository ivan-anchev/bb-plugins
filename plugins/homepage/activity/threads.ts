// Start times of the threads you started (no subagents or forks), active and
// archived, read page by page from the server's thread list.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const PAGE = 200;

export async function readThreadStarts(sdk: BbPluginApi["sdk"], since: number): Promise<number[]> {
  const starts: number[] = [];
  for (const archived of [false, true]) {
    for (let offset = 0; ; offset += PAGE) {
      const page = await sdk.threads.list({ hasParent: false, archived, limit: PAGE, offset });
      starts.push(...page.map((t) => t.createdAt).filter((at) => at >= since));
      if (page.length < PAGE) break;
    }
  }
  return starts;
}
