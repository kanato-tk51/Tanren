"use client";

import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc/react";
import type { AppRouter } from "@/server/trpc/routers";

type TrendsResult = inferRouterOutputs<AppRouter>["insights"]["trends"];
type TrendPoint = TrendsResult["points"][number];

const CHART_W = 560;
const CHART_H = 140;
const PAD = { top: 8, right: 8, bottom: 18, left: 32 };

/** 純粋 SVG の折れ線 / 棒グラフ (issue #33, CLAUDE.md §3: Recharts/D3 非採用)。 */

function niceTickStep(maxValue: number): number {
  if (maxValue <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(maxValue)));
  const norm = maxValue / pow;
  const step = norm <= 1 ? 0.25 : norm <= 2 ? 0.5 : norm <= 5 ? 1 : 2;
  return step * pow;
}

function LineChart({
  points,
  yAccessor,
  yMax,
  color,
  label,
  yFormat,
}: {
  points: TrendPoint[];
  yAccessor: (p: TrendPoint) => number;
  yMax: number;
  color: string;
  label: string;
  yFormat: (v: number) => string;
}) {
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const n = points.length;
  const xStep = n > 1 ? innerW / (n - 1) : 0;
  const yScale = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${PAD.left + i * xStep} ${yScale(yAccessor(p))}`)
    .join(" ");
  const ticks = [0, yMax / 2, yMax];
  const firstDate = points[0]?.date ?? "";
  const lastDate = points[n - 1]?.date ?? "";
  return (
    <figure className="space-y-1">
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" role="img" aria-label={label}>
        {/* grid + y ticks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              y1={yScale(t)}
              x2={CHART_W - PAD.right}
              y2={yScale(t)}
              stroke="currentColor"
              strokeOpacity={0.1}
            />
            <text
              x={PAD.left - 4}
              y={yScale(t) + 3}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {yFormat(t)}
            </text>
          </g>
        ))}
        {/* line */}
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} />
        {/* x 軸 (最初と最後の日付のみ) */}
        <text x={PAD.left} y={CHART_H - 4} fontSize={9} fill="currentColor" fillOpacity={0.7}>
          {firstDate}
        </text>
        <text
          x={CHART_W - PAD.right}
          y={CHART_H - 4}
          textAnchor="end"
          fontSize={9}
          fill="currentColor"
          fillOpacity={0.7}
        >
          {lastDate}
        </text>
      </svg>
    </figure>
  );
}

function BarChart({
  points,
  yAccessor,
  yMax,
  color,
  label,
  yFormat,
}: {
  points: TrendPoint[];
  yAccessor: (p: TrendPoint) => number;
  yMax: number;
  color: string;
  label: string;
  yFormat: (v: number) => string;
}) {
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const n = points.length;
  const barW = n > 0 ? (innerW / n) * 0.8 : 0;
  const xStep = n > 0 ? innerW / n : 0;
  const yScale = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
  const ticks = [0, yMax / 2, yMax];
  const firstDate = points[0]?.date ?? "";
  const lastDate = points[n - 1]?.date ?? "";
  return (
    <figure className="space-y-1">
      <figcaption className="text-muted-foreground text-xs">{label}</figcaption>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" role="img" aria-label={label}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              y1={yScale(t)}
              x2={CHART_W - PAD.right}
              y2={yScale(t)}
              stroke="currentColor"
              strokeOpacity={0.1}
            />
            <text
              x={PAD.left - 4}
              y={yScale(t) + 3}
              textAnchor="end"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {yFormat(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const v = yAccessor(p);
          const y = yScale(v);
          const x = PAD.left + i * xStep + (xStep - barW) / 2;
          return (
            <rect
              key={p.date}
              x={x}
              y={y}
              width={barW}
              height={PAD.top + innerH - y}
              fill={color}
              opacity={0.85}
            >
              <title>
                {p.date}: {yFormat(v)}
              </title>
            </rect>
          );
        })}
        <text x={PAD.left} y={CHART_H - 4} fontSize={9} fill="currentColor" fillOpacity={0.7}>
          {firstDate}
        </text>
        <text
          x={CHART_W - PAD.right}
          y={CHART_H - 4}
          textAnchor="end"
          fontSize={9}
          fill="currentColor"
          fillOpacity={0.7}
        >
          {lastDate}
        </text>
      </svg>
    </figure>
  );
}

export function TrendsScreen() {
  const { data, isLoading, error } = trpc.insights.trends.useQuery();

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

  const points = data.points;
  const maxAttempt = Math.max(1, ...points.map((p) => p.attemptCount));
  const maxTime = Math.max(1, ...points.map((p) => p.studyTimeMin));
  // Y 軸の見た目を綺麗な目盛りに (maxAttempt=3 なら 4 まで切り上げ等)
  const tickMaxAttempt =
    Math.ceil(maxAttempt / niceTickStep(maxAttempt)) * niceTickStep(maxAttempt);
  const tickMaxTime = Math.ceil(maxTime / niceTickStep(maxTime)) * niceTickStep(maxTime);

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Trends</CardTitle>
        <CardDescription>
          直近 {data.days} 日の日次推移 (JST)。MVP は attempts を GROUP BY DATE で集計。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <BarChart
          points={points}
          yAccessor={(p) => p.attemptCount}
          yMax={tickMaxAttempt}
          color="#3b82f6"
          label="📊 出題数 / 日"
          yFormat={(v) => String(Math.round(v))}
        />
        <LineChart
          points={points}
          yAccessor={(p) => p.accuracyPct}
          yMax={1}
          color="#22c55e"
          label="✓ 正答率 (%) / 日"
          yFormat={(v) => `${Math.round(v * 100)}%`}
        />
        <LineChart
          points={points}
          yAccessor={(p) => p.studyTimeMin}
          yMax={tickMaxTime}
          color="#eab308"
          label="⏱ 学習時間 (分) / 日"
          yFormat={(v) => `${v.toFixed(1)}`}
        />
        <div className="text-muted-foreground text-xs">
          <Link href="/insights" className="underline">
            ← Dashboard に戻る
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
