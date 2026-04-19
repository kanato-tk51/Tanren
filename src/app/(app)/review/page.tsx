import { ReviewScreen } from "@/features/review/review-screen";

export const dynamic = "force-dynamic";

export default function ReviewPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <ReviewScreen />
    </main>
  );
}
