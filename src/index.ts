import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { registerImageGuard } from "./extension.ts";

export default function imageGuard(pi: ExtensionAPI) {
  registerImageGuard(pi, join(getAgentDir(), "image-guard.json"));
}
