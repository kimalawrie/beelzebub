/**
 * Competition Mode — 24hr Wager Dashboard
 * "A 5090 making bad decisions faster still loses."
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  RadialBarChart, RadialBar, ResponsiveContainer,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  Trophy, Zap, Clock, Target, TrendingUp, Server, Wifi,
  AlertTriangle, Shield, Activity, Flame,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

// ── Types ──────────────────────────────────────────────────────────────────

interface CompetitionStatus {
  sessionStarted: boolean;
  startTime: number | null;
  currentTime: number;
  elapsed: number;
  remaining: number;
  portfolioValue: number;
  startingCapital: number;
  pnl: number;
  pnlPct: number;
  winProbability: number;
  tradesExecuted: number;
  currentStreak: number;
  edgeScore: number;
}

interface OFISummary {
  midPrice: number; spread: number; spreadBps: number;
  ofi: number; depthRatio: number; bidDepth: number; askDepth: number;
  aggressionScore: number; momentumIgnition: boolean;
  momentumDirection: "up" | "down" | null;
  executionQuality: "excellent" | "good" | "poor" | "avoid";
  latencyMs: number | null; latencyQuality: "green" | "yellow" | "red";
  isConnected: boolean;
}

interface ExecutionWindow {
  shouldTrade: boolean; reason: string; confidence: number;
  expectedSlippageBps: number; optimalSide: "buy" | "sell" | null;
  urgency: "immediate" | "wait" | "abort";
}

interface InfrastructureData {
  recommendation: string;
  regions: Array<{
    name: string; region: string; estimatedLatencyMs: number;
    rank: number; notes: string;
  }>;
  instanceRecommendation: string;
  estimatedCostPerHour: string;
  tradingWindows: Array<{ window: string; quality: string; notes: string }>;
  avoidWindows: Array<{ window: string; reason: string }>;
  competitionAdvice: string[];
}

interface LatencyData {
  history: Array<{ timestamp: number; roundTripMs: number; quality: string }>;
  avgMs: number; p99Ms: number; latencySpikes: number; currentQuality: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtGbp(v: number) {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}£${abs.toFixed(2)}`;
}

function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }

// ── Countdown Timer ────────────────────────────────────────────────────────

function CountdownTimer({ remaining, elapsed, total }: { remaining: number; elapsed: number; total: number }) {
  const pct = Math.min(100, (elapsed / total) * 100);
  const isLow = remaining < 3600000; // < 1 hour
  const isEnd = remaining < 300000;  // < 5 min

  return (
    <div className="space-y-3">
      {/* Big timer */}
      <div className="text-center">
        <div className={`text-4xl font-bold font-mono tabular tracking-wider ${isEnd ? "text-red-400 animate-pulse" : isLow ? "text-yellow-400" : "text-primary"}`}>
          {fmtDuration(remaining)}
        </div>
        <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">
          {isEnd ? "FINAL STRETCH" : isLow ? "Under 1 hour remaining" : "Remaining"}
        </div>
      </div>
      {/* Progress bar */}
      <div className="relative h-2 rounded-full bg-accent overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000"
          style={{
            width: `${pct}%`,
            background: isEnd
              ? "hsl(0 72% 55%)"
              : isLow
              ? "hsl(38 100% 60%)"
              : "hsl(160 100% 45%)",
          }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Elapsed: {fmtDuration(elapsed)}</span>
        <span>{pct.toFixed(1)}% complete</span>
        <span>Total: 24:00:00</span>
      </div>
    </div>
  );
}

// ── Win Probability Gauge ──────────────────────────────────────────────────

function WinProbGauge({ probability }: { probability: number }) {
  const clamp = Math.max(0, Math.min(100, probability));
  const color = clamp > 60 ? "hsl(160 100% 45%)" : clamp > 40 ? "hsl(38 100% 60%)" : "hsl(0 72% 55%)";
  const data = [{ value: clamp, fill: color }, { value: 100 - clamp, fill: "hsl(var(--accent))" }];

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-28 h-28">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart cx="50%" cy="50%" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} data={data}>
            <RadialBar dataKey="value" cornerRadius={4} background={false} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold font-mono tabular" style={{ color }}>{clamp.toFixed(0)}%</span>
          <span className="text-[9px] text-muted-foreground uppercase">Win Prob</span>
        </div>
      </div>
    </div>
  );
}

// ── Edge Metric Bar ────────────────────────────────────────────────────────

function EdgeBar({ label, value, max = 100, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold" style={{ color }}>{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-accent overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// ── Execution Urgency Badge ────────────────────────────────────────────────

function UrgencyBadge({ urgency }: { urgency: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    immediate: { bg: "bg-green-400/10 border-green-400/30 text-green-400", text: "EXECUTE NOW" },
    wait:      { bg: "bg-yellow-400/10 border-yellow-400/30 text-yellow-400", text: "WAIT" },
    abort:     { bg: "bg-red-500/10 border-red-500/30 text-red-400", text: "ABORT" },
  };
  const s = map[urgency] ?? map.wait;
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded border text-xs font-bold uppercase tracking-wider ${s.bg}`}>
      {s.text}
    </span>
  );
}

// ── Competition Status Mock (for demo when no active competition) ──────────

function buildDemoStatus(): CompetitionStatus {
  const now = Date.now();
  const start = now - 4.5 * 3600 * 1000; // 4.5 hours in
  const total = 24 * 3600 * 1000;
  const elapsed = now - start;
  const remaining = Math.max(0, total - elapsed);
  const pnl = 312.50;
  const startCapital = 10000;
  return {
    sessionStarted: true, startTime: start, currentTime: now,
    elapsed, remaining, portfolioValue: startCapital + pnl,
    startingCapital: startCapital, pnl, pnlPct: (pnl / startCapital) * 100,
    winProbability: 71, tradesExecuted: 14, currentStreak: 3, edgeScore: 78,
  };
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function Competition() {
  const [now, setNow] = useState(Date.now());

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: competitionData } = useQuery<CompetitionStatus>({
    queryKey: ["/api/competition/status"],
    refetchInterval: 5000,
  });
  const { data: ofi } = useQuery<OFISummary>({
    queryKey: ["/api/orderflow/summary"],
    refetchInterval: 1000,
  });
  const { data: execWindow } = useQuery<ExecutionWindow>({
    queryKey: ["/api/orderflow/execution-window", "buy"],
    queryFn: () => apiRequest("GET", "/api/orderflow/execution-window?side=buy"),
    refetchInterval: 2000,
  });
  const { data: infra } = useQuery<InfrastructureData>({
    queryKey: ["/api/infrastructure"],
    refetchInterval: 60000,
  });
  const { data: latency } = useQuery<LatencyData>({
    queryKey: ["/api/latency"],
    refetchInterval: 2000,
  });

  // Build competition state
  const comp = competitionData ?? buildDemoStatus();
  const isDemo = !competitionData?.sessionStarted;
  const total24h = 24 * 3600 * 1000;

  // Recompute remaining using live clock
  const elapsed = comp.startTime ? now - comp.startTime : comp.elapsed;
  const remaining = Math.max(0, total24h - elapsed);

  // Latency chart data
  const latencyChartData = (latency?.history ?? []).slice(-60).map(l => ({
    time: format(new Date(l.timestamp), "HH:mm:ss"),
    ms: l.roundTripMs,
  }));

  const latencyColor = (latency?.currentQuality === "green") ? "hsl(160 100% 45%)" :
    (latency?.currentQuality === "yellow") ? "hsl(38 100% 60%)" : "hsl(0 72% 55%)";

  return (
    <div className="p-5 space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Trophy size={18} className="text-yellow-400" />
            <h1 className="text-lg font-bold text-foreground">Competition Mode</h1>
            {isDemo && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-yellow-400/30 bg-yellow-400/10 text-yellow-400 font-bold uppercase">Demo</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            24-hour wager · £100 stake · vs RTX 5090
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Your edge: order flow intelligence + latency awareness</div>
          <div className="text-xs text-primary font-medium mt-0.5">Speed without strategy is just expensive noise.</div>
        </div>
      </div>

      {/* ── Row 1: Timer + Stake + Win Prob ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Countdown */}
        <Card className="border-border bg-card lg:col-span-1">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock size={14} className="text-primary" />
              Time Remaining
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <CountdownTimer
              remaining={remaining}
              elapsed={elapsed}
              total={total24h}
            />
          </CardContent>
        </Card>

        {/* Stake P&L */}
        <Card className="border-border bg-card lg:col-span-1">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp size={14} className="text-primary" />
              Wager P&L
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {/* P&L */}
            <div className="text-center space-y-1">
              <div className={`text-3xl font-bold font-mono tabular ${comp.pnl >= 0 ? "gain" : "loss"}`}>
                {fmtGbp(comp.pnl * 0.01)} {/* Scale $10k sim to £100 stake */}
              </div>
              <div className={`text-sm font-mono ${comp.pnlPct >= 0 ? "gain" : "loss"}`}>
                {fmtPct(comp.pnlPct)} return
              </div>
              <div className="text-xs text-muted-foreground">
                Portfolio: £{((comp.portfolioValue / comp.startingCapital) * 100).toFixed(2)} / £100 stake
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border text-center">
              <div>
                <div className="text-lg font-bold font-mono text-foreground tabular">{comp.tradesExecuted}</div>
                <div className="text-[10px] text-muted-foreground uppercase">Trades</div>
              </div>
              <div>
                <div className={`text-lg font-bold font-mono tabular ${comp.currentStreak > 0 ? "gain" : comp.currentStreak < 0 ? "loss" : "text-foreground"}`}>
                  {comp.currentStreak > 0 ? `+${comp.currentStreak}` : comp.currentStreak}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">Streak</div>
              </div>
              <div>
                <div className="text-lg font-bold font-mono text-foreground tabular">
                  {comp.edgeScore}
                </div>
                <div className="text-[10px] text-muted-foreground uppercase">Edge Score</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Win Probability */}
        <Card className="border-border bg-card lg:col-span-1">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Target size={14} className="text-primary" />
              Win Probability
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex items-center justify-between gap-4">
              <WinProbGauge probability={comp.winProbability} />
              <div className="flex-1 space-y-3">
                <EdgeBar
                  label="OFI Score"
                  value={ofi ? Math.abs(ofi.ofi) * 100 : 65}
                  color="hsl(160 100% 45%)"
                />
                <EdgeBar
                  label="Exec Quality"
                  value={ofi ? (ofi.executionQuality === "excellent" ? 95 : ofi.executionQuality === "good" ? 75 : ofi.executionQuality === "poor" ? 35 : 10) : 75}
                  color="hsl(200 100% 60%)"
                />
                <EdgeBar
                  label="Latency Quality"
                  value={latency ? (latency.currentQuality === "green" ? 90 : latency.currentQuality === "yellow" ? 55 : 15) : 80}
                  color={latencyColor}
                />
                <EdgeBar
                  label="Strategy Alignment"
                  value={comp.edgeScore}
                  color="hsl(271 91% 65%)"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 2: Live Execution Advisor + Momentum ──────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Smart Execution Advisor */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap size={14} className="text-primary" />
              Smart Execution Advisor
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {execWindow ? (
              <>
                <div className="flex items-center justify-between">
                  <UrgencyBadge urgency={execWindow.urgency} />
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">Confidence</div>
                    <div className="text-lg font-bold font-mono tabular text-foreground">{execWindow.confidence}%</div>
                  </div>
                </div>

                {/* Confidence bar */}
                <div className="space-y-1">
                  <div className="h-2 rounded-full bg-accent overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${execWindow.confidence}%`,
                        background: execWindow.confidence > 70 ? "hsl(160 100% 45%)" : execWindow.confidence > 50 ? "hsl(38 100% 60%)" : "hsl(0 72% 55%)"
                      }}
                    />
                  </div>
                </div>

                {/* Reason */}
                <div className="p-3 rounded-lg bg-accent/50 text-xs text-muted-foreground font-mono leading-relaxed">
                  {execWindow.reason}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground">Expected Slippage</span>
                    <div className="font-mono font-semibold text-foreground">{execWindow.expectedSlippageBps.toFixed(2)} bps</div>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-muted-foreground">Optimal Side</span>
                    <div className={`font-mono font-semibold ${execWindow.optimalSide === "buy" ? "gain" : execWindow.optimalSide === "sell" ? "loss" : "text-muted-foreground"}`}>
                      {execWindow.optimalSide?.toUpperCase() ?? "NEUTRAL"}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {/* Real-time OFI snapshot */}
            {ofi && (
              <div className="border-t border-border pt-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">OFI</div>
                  <div className={`font-mono font-bold ${ofi.ofi >= 0 ? "gain" : "loss"}`}>{ofi.ofi >= 0 ? "+" : ""}{ofi.ofi.toFixed(3)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Spread</div>
                  <div className="font-mono font-semibold text-foreground">{ofi.spreadBps.toFixed(2)}bps</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Aggression</div>
                  <div className={`font-mono font-semibold ${ofi.aggressionScore > 60 ? "gain" : ofi.aggressionScore < 40 ? "loss" : "text-foreground"}`}>
                    {ofi.aggressionScore.toFixed(0)}%
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Latency Monitor */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Wifi size={14} className="text-primary" />
                Latency Monitor
              </CardTitle>
              {latency && (
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${latency.currentQuality === "green" ? "bg-green-400" : latency.currentQuality === "yellow" ? "bg-yellow-400" : "bg-red-500 animate-pulse"}`} />
                  <span className="font-mono text-xs font-bold" style={{ color: latencyColor }}>
                    {latency.avgMs.toFixed(0)}ms avg
                  </span>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            {latencyChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={latencyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis hide />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={30} tickFormatter={v => `${v}ms`} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                    formatter={(v: any) => [`${Number(v).toFixed(1)}ms`, "RTT"]}
                  />
                  <Area type="monotone" dataKey="ms" fill={`${latencyColor}20`} stroke={latencyColor} strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-[120px] w-full" />
            )}

            {latency && (
              <div className="grid grid-cols-3 gap-2 px-2 mt-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Average</div>
                  <div className="font-mono font-semibold text-foreground">{latency.avgMs.toFixed(1)}ms</div>
                </div>
                <div>
                  <div className="text-muted-foreground">P99</div>
                  <div className="font-mono font-semibold text-foreground">{latency.p99Ms.toFixed(1)}ms</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Spikes</div>
                  <div className={`font-mono font-semibold ${latency.latencySpikes > 3 ? "text-yellow-400" : "text-foreground"}`}>{latency.latencySpikes}</div>
                </div>
              </div>
            )}

            {/* Latency quality warning */}
            {latency?.currentQuality === "red" && (
              <div className="mx-2 mt-3 flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold">
                <AlertTriangle size={12} />
                HIGH LATENCY — pause trading this window
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Momentum Ignition Alert ────────────────────────────────────────── */}
      {ofi?.momentumIgnition && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-yellow-400">
          <Flame size={20} className="flex-shrink-0 animate-pulse" />
          <div>
            <div className="font-bold text-sm">MOMENTUM IGNITION DETECTED — {ofi.momentumDirection?.toUpperCase()}</div>
            <div className="text-xs text-yellow-400/80 mt-0.5">
              OFI spike + aggression extreme + depth imbalanced. Algo pump in progress. {ofi.momentumDirection === "up" ? "Consider riding momentum buy." : "Consider momentum sell."}
            </div>
          </div>
        </div>
      )}

      {/* ── Infrastructure Advisor ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AWS Regions */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Server size={14} className="text-primary" />
              Infrastructure Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {infra ? (
              <>
                <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary font-medium leading-relaxed">
                  {infra.recommendation}
                </div>

                {/* Regions */}
                <div className="space-y-2">
                  {infra.regions.slice(0, 3).map((r, i) => (
                    <div key={r.region} className={`flex items-center justify-between p-2.5 rounded-lg border text-xs ${i === 0 ? "border-primary/30 bg-primary/5" : "border-border bg-accent/30"}`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                          {r.rank}
                        </span>
                        <div>
                          <div className={`font-semibold ${i === 0 ? "text-primary" : "text-foreground"}`}>{r.name}</div>
                          <div className="text-muted-foreground font-mono text-[10px]">{r.region}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-mono font-bold ${i === 0 ? "text-primary" : "text-foreground"}`}>{r.estimatedLatencyMs}ms</div>
                        <div className="text-muted-foreground text-[10px]">RTT to Binance</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Instance */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
                  <span className="text-muted-foreground">Recommended instance</span>
                  <span className="font-mono font-semibold text-foreground">{infra.instanceRecommendation}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Cost for 24hr window</span>
                  <span className="font-mono font-semibold gain">~{infra.estimatedCostPerHour} × 24hr</span>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trading Windows */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock size={14} className="text-primary" />
              Optimal Trading Windows (UTC)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {infra ? (
              <>
                {/* Best windows */}
                <div className="space-y-2">
                  {infra.tradingWindows.slice(0, 3).map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg border border-green-500/20 bg-green-500/5">
                      <div className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0 mt-1" />
                      <div className="text-xs flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold text-green-400">{w.window}</span>
                          <span className="text-[10px] text-green-400/70 uppercase">{w.quality}</span>
                        </div>
                        <div className="text-muted-foreground mt-0.5">{w.notes}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Avoid windows */}
                <div className="text-xs text-muted-foreground uppercase tracking-wider pt-1">Avoid</div>
                <div className="space-y-2">
                  {infra.avoidWindows.slice(0, 2).map((w, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-lg border border-red-500/20 bg-red-500/5">
                      <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0 mt-1" />
                      <div className="text-xs flex-1">
                        <span className="font-mono font-semibold text-red-400">{w.window}</span>
                        <div className="text-muted-foreground mt-0.5">{w.reason}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Competition Advice ─────────────────────────────────────────────── */}
      {infra?.competitionAdvice && (
        <Card className="border-border bg-card border-primary/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield size={14} className="text-primary" />
              Your Edge vs RTX 5090
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {infra.competitionAdvice.map((tip, i) => (
                <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-primary/5 border border-primary/15 text-xs">
                  <span className="text-primary font-bold flex-shrink-0 mt-0.5">→</span>
                  <span className="text-muted-foreground leading-relaxed">{tip}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Demo notice */}
      {isDemo && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">
          <AlertTriangle size={14} />
          <span>Competition clock starts automatically when the wager begins. Data shown is based on simulated competition state.</span>
        </div>
      )}
    </div>
  );
}
