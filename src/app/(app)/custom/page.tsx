import { CustomScreen } from "@/features/custom/custom-screen";

export const dynamic = "force-dynamic";

function pickFirstString(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : undefined;
}

export default async function CustomPage({
  searchParams,
}: {
  searchParams?: Promise<{ prefill?: string | string[]; conceptId?: string | string[] }>;
}) {
  const params = await searchParams;
  // Next.js の searchParams は string | string[] | undefined のため単一化してから渡す。
  // ?prefill=a&prefill=b のような多値クエリは先頭を採用。
  const initialRaw = pickFirstString(params?.prefill)?.slice(0, 2000);
  // Insights Dashboard 等から ?conceptId=... で来た場合は、LLM parse を迂回して
  // decoding で customSpec.concepts = [conceptId] を固定する (Round 3 指摘 #1: parser の
  // 出力次第で別 concept になるリスクを回避し、「この concept だけ Custom Session」を確実に保証)。
  const initialConceptId = pickFirstString(params?.conceptId)?.slice(0, 200);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <CustomScreen initialRaw={initialRaw} initialConceptId={initialConceptId} />
    </main>
  );
}
