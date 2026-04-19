import { DrillScreen } from "@/features/drill/drill-screen";

export const dynamic = "force-dynamic";

export default function DrillPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <DrillScreen />
    </main>
  );
}
