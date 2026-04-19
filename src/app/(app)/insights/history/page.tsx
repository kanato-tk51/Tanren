import { HistoryScreen } from "@/features/insights/history-screen";

export const dynamic = "force-dynamic";

export default function InsightsHistoryPage() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <HistoryScreen />
    </main>
  );
}
