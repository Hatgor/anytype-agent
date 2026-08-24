import { tap } from "rxjs/operators";
import { AnytypeClient } from "./client";
import { getAppConfig } from "./config";
import { initSpaceOrchestrator, type SpaceEvent } from "./space";

async function main() {
  console.log("🌟 [AnytypeAgent] Starting Anytype Agent Daemon...");

  let config;
  try {
    config = getAppConfig();
  } catch (err: any) {
    console.error("❌ [AnytypeAgent] Configuration Error:", err.message);
    process.exit(1);
  }

  console.log(`🤖 Bot Name: ${config.ANYTYPE_BOT_NAME}`);
  console.log(`🔌 Anytype API: ${config.ANYTYPE_API_URL}`);

  const client = new AnytypeClient(config);

  // Wait for Anytype CLI API to become ready (handles cold boot / auto-login)
  await client.waitForReady();

  const allEvents$ = await initSpaceOrchestrator(client, config.ANYTYPE_BOT_NAME);

  console.log("📡 [AnytypeAgent] Subscribing to all space events...");

  allEvents$
    .pipe(
      tap((event: SpaceEvent) => {
        console.log(`\n🔔 [New Event Received]`);
        console.dir(event, { depth: null });
      }),
    )
    .subscribe({
      error: (err) => {
        console.error("❌ [AnytypeAgent] Stream Error:", err);
      },
      complete: () => {
        console.log("🏁 [AnytypeAgent] All space streams completed.");
      },
    });
}

main().catch((err) => {
  console.error("💥 [AnytypeAgent] Fatal error:", err);
  process.exit(1);
});
