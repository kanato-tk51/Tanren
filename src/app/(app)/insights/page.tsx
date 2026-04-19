import { InsightsOverviewScreen } from "@/features/insights/overview-screen";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <InsightsOverviewScreen />
    </main>
  );
}
