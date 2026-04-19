import { SearchScreen } from "@/features/insights/search-screen";

export const dynamic = "force-dynamic";

export default function InsightsSearchPage() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <SearchScreen />
    </main>
  );
}
