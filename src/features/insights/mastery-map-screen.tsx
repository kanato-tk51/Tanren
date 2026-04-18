"use client";

import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { AppRouter } from "@/server/trpc/routers";
import type { MasteryTier } from "@/server/insights/mastery-map";
import { trpc } from "@/lib/trpc/react";

type MasteryMap = inferRouterOutputs<AppRouter>["insights"]["masteryMap"];

/** SVG 座標系は上 = 負 Y。sunburst は 12 時方向から時計回りに描画する。 */
const SIZE = 360;
const CENTER = SIZE / 2;
/** 3 rings: domain / subdomain / concept */
const RING_WIDTHS = {
  domain: { inner: 0, outer: 48 },
  subdomain: { inner: 48, outer: 108 },
  concept: { inner: 108, outer: 170 },
} as const;

const TIER_COLOR: Record<MasteryTier, string> = {
  untouched: "#9ca3af", // gray-400
  weak: "#ef4444", // red-500
  mid: "#eab308", // yellow-500
  mastered: "#22c55e", // green-500
};

/** domain / subdomain など attempt>0 なしで ring に色をつけるために、
 *  平均 masteryPct と「観測 concept が 1 つでもあるか」で tier を近似する */
function tierFromAggregate(args: { masteryPct: number; attemptCount: number }): MasteryTier {
  if (args.attemptCount <= 0) return "untouched";
  if (args.masteryPct < 0.4) return "weak";
  if (args.masteryPct < 0.8) return "mid";
  return "mastered";
}

/** SVG path: 円環 (ドーナツ) の弧セグメントを 1 つ描く */
function arcPath(opts: {
  startAngle: number; // rad, 12 時方向 = -π/2
  endAngle: number;
  innerR: number;
  outerR: number;
}): string {
  const { startAngle, endAngle, innerR, outerR } = opts;
  const x1 = CENTER + outerR * Math.cos(startAngle);
  const y1 = CENTER + outerR * Math.sin(startAngle);
  const x2 = CENTER + outerR * Math.cos(endAngle);
  const y2 = CENTER + outerR * Math.sin(endAngle);
  const x3 = CENTER + innerR * Math.cos(endAngle);
  const y3 = CENTER + innerR * Math.sin(endAngle);
  const x4 = CENTER + innerR * Math.cos(startAngle);
  const y4 = CENTER + innerR * Math.sin(startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

/** concept の面積 (= 角度 span) を決める。
 *  docs/05 §5.4 では attemptCount に比例。MVP は「まだ解いていない concept も目視できる
 *  よう最低 1 カウント (smoothing) 扱い」で始める。
 */
function normalizedWeight(attemptCount: number): number {
  return attemptCount + 1;
}

type Arc = {
  key: string;
  path: string;
  tier: MasteryTier;
  tooltip: string;
  href?: string; // concept だけ drill-down 可能
  conceptId?: string;
};

function buildArcs(data: MasteryMap): Arc[] {
  const arcs: Arc[] = [];
  if (data.domains.length === 0) return arcs;

  const totalWeight = data.domains.reduce((acc, d) => {
    return (
      acc +
      d.subdomains.reduce((sa, s) => {
        return sa + s.concepts.reduce((ca, c) => ca + normalizedWeight(c.attemptCount), 0);
      }, 0)
    );
  }, 0);
  if (totalWeight === 0) return arcs;

  const START = -Math.PI / 2; // 12 時方向
  const FULL = 2 * Math.PI;

  let cursor = START;
  for (const d of data.domains) {
    const dWeight = d.subdomains.reduce(
      (sa, s) => sa + s.concepts.reduce((ca, c) => ca + normalizedWeight(c.attemptCount), 0),
      0,
    );
    const dSpan = (dWeight / totalWeight) * FULL;
    const dStart = cursor;
    const dEnd = cursor + dSpan;

    // domain ring
    arcs.push({
      key: `d:${d.domainId}`,
      path: arcPath({
        startAngle: dStart,
        endAngle: dEnd,
        innerR: RING_WIDTHS.domain.inner,
        outerR: RING_WIDTHS.domain.outer,
      }),
      tier: tierFromAggregate({ masteryPct: d.masteryPct, attemptCount: d.attemptCount }),
      tooltip: `${d.domainId} (${Math.round(d.masteryPct * 100)}%, ${d.attemptCount} 問)`,
    });

    let subCursor = dStart;
    for (const s of d.subdomains) {
      const sWeight = s.concepts.reduce((ca, c) => ca + normalizedWeight(c.attemptCount), 0);
      const sSpan = (sWeight / totalWeight) * FULL;
      const sStart = subCursor;
      const sEnd = subCursor + sSpan;

      arcs.push({
        key: `s:${d.domainId}/${s.subdomainId}`,
        path: arcPath({
          startAngle: sStart,
          endAngle: sEnd,
          innerR: RING_WIDTHS.subdomain.inner,
          outerR: RING_WIDTHS.subdomain.outer,
        }),
        tier: tierFromAggregate({ masteryPct: s.masteryPct, attemptCount: s.attemptCount }),
        tooltip: `${d.domainId} / ${s.subdomainId} (${Math.round(s.masteryPct * 100)}%, ${s.attemptCount} 問)`,
      });

      let cCursor = sStart;
      for (const c of s.concepts) {
        const cWeight = normalizedWeight(c.attemptCount);
        const cSpan = (cWeight / totalWeight) * FULL;
        const cStart = cCursor;
        const cEnd = cCursor + cSpan;
        arcs.push({
          key: `c:${c.conceptId}`,
          path: arcPath({
            startAngle: cStart,
            endAngle: cEnd,
            innerR: RING_WIDTHS.concept.inner,
            outerR: RING_WIDTHS.concept.outer,
          }),
          tier: c.tier,
          tooltip: `${c.conceptName} (${Math.round(c.masteryPct * 100)}%, ${c.attemptCount} 問)`,
          conceptId: c.conceptId,
          href: `/custom?conceptId=${encodeURIComponent(c.conceptId)}`,
        });
        cCursor = cEnd;
      }
      subCursor = sEnd;
    }
    cursor = dEnd;
  }
  return arcs;
}

function Legend() {
  const items: Array<{ tier: MasteryTier; label: string }> = [
    { tier: "untouched", label: "未着手" },
    { tier: "weak", label: "苦手 <40%" },
    { tier: "mid", label: "中 40-80%" },
    { tier: "mastered", label: "習得 80%+" },
  ];
  return (
    <ul className="text-muted-foreground flex flex-wrap gap-3 text-xs">
      {items.map(({ tier, label }) => (
        <li key={tier} className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-3 rounded-sm"
            style={{ backgroundColor: TIER_COLOR[tier] }}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function MasteryMapScreen() {
  const router = useRouter();
  const { data, isLoading, error } = trpc.insights.masteryMap.useQuery();

  if (isLoading) {
    return (
      <Card className="w-full max-w-2xl">
        <CardContent className="text-muted-foreground p-6 text-sm">読み込み中…</CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="w-full max-w-2xl">
        <CardContent className="text-destructive p-6 text-sm">{error.message}</CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const arcs = buildArcs(data);

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Mastery Map</CardTitle>
        <CardDescription>
          中心=domain、中層=subdomain、外層=concept。色 = mastery tier、面積 = attempt 数 (+1
          smoothing)。 外層をタップで concept 詳細 (Custom Session) にドリルダウン。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {arcs.length === 0 ? (
          <div className="text-muted-foreground text-sm">
            表示できる concept がありません。seed を確認してください。
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <svg
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              role="img"
              aria-label="Mastery Map sunburst"
              className="w-full max-w-sm"
            >
              {arcs.map((a) => (
                <path
                  key={a.key}
                  d={a.path}
                  fill={TIER_COLOR[a.tier]}
                  stroke="#fff"
                  strokeWidth={1.2}
                  className={cn(a.href && "cursor-pointer")}
                  onClick={() => a.href && router.push(a.href)}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && a.href) {
                      router.push(a.href);
                    }
                  }}
                  tabIndex={a.href ? 0 : -1}
                  role={a.href ? "button" : undefined}
                >
                  <title>{a.tooltip}</title>
                </path>
              ))}
            </svg>
            <Legend />
          </div>
        )}
        <div className="text-muted-foreground text-xs">
          <Link href="/insights" className="underline">
            ← Dashboard に戻る
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
