import cron from "node-cron";
import { generateDailyReport } from "./daily-report.js";

export function startScheduler() {
  const task = cron.schedule(
    "0 9 * * *",
    async () => {
      console.log(
        "📅 Starting scheduled daily report at",
        new Date().toISOString()
      );

      try {
        await generateDailyReport();
        console.log("✅ Scheduled daily report completed successfully");
      } catch (error) {
        console.error("❌ Error in scheduled daily report:", error);
      }
    },
    {
      scheduled: true,
      timezone: "Asia/Seoul",
    }
  );

  console.log(
    "⏰ Daily report scheduler started - will run every day at 9:00 AM KST"
  );

  return task;
}