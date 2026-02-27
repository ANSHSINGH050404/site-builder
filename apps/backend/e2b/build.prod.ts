import "dotenv/config";
import { Template, defaultBuildLogger } from "e2b";
import { reactTemplate } from "./e2b-template";

async function main() {
  await Template.build(reactTemplate, {
    alias: "site-builder-react-base", // prod alias (no -dev suffix)
    cpuCount: 2,
    memoryMB: 2048,
    onBuildLogs: defaultBuildLogger(),
  });
  console.log("Production template built successfully");
}

main().catch(console.error);
