// No server work yet: tabs live in each bb window.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default function plugin(bb: BbPluginApi): void {
  bb.log.info("loaded");
}
