import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Play, Square, RefreshCw, TrendingUp, TrendingDown, DollarSign, Target, Zap, AlertTriangle, Wifi, WifiOff, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot, ComposedChart, Bar,
} from "recharts";
import { format } from "date-fns";
import type { BotConfig, Trade, PortfolioSnapshot, PriceCandle } from "@shared/schema";

interface Stats {
  totalTrades: number; wins: number; losses: number;
  winRate: number; totalPnl: number; avgWin: number; avgLoss: number;
  profitFactor: number; maxDrawdown: number; totalReturn: number;
  sharpe: number; initialCapital: number; finalValue: number;
}

interface LatestPortfolio {
  totalValue: number; cashBalance: number; cryptoValue: number;
  realizedPnl: number; unrealizedPnl: number; drawdown: number;
}

interface LivePrice { symbol: string; price: number; change24h: number; }

interface OFISummary {
  midPrice: number; spread: number; spreadBps: number;
  ofi: number; depthRatio: number; bidDepth: number; askDepth: number;
  aggressionScore: number; momentumIgnition: boolean;
  momentumDirection: "up" | "down" | null;
  executionQuality: "excellent" | "good" | "poor" | "avoid";
  latencyMs: number | null; latencyQuality: "green" | "yellow" | "red";
  isConnected: boolean;
}

interface OFIHistoryItem {
  timestamp: number; ofi: number; ofiSmooth: number;
  spreadBps: number; aggressionScore: number;
  momentumIgnition: boolean; executionQuality: string;
}

interface OrderBookLevel { price: number; qty: number; }
interface OrderBook { bids: OrderBookLevel[]; asks: OrderBookLevel[]; }

function KpiCard({ title, value, sub, positive, icon: Icon, loading }: {
  title: string; value: string; sub?: string;
  positive?: boolean | null; icon: React.ComponentType<any>; loading?: boolean;
}) {
  return (
    <Card className="panel-hover border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0 flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wider truncate">{title}</p>
            {loading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <p className={`text-xl font-bold tabular font-mono leading-tight ${positive === true ? "gain" : positive === false ? "loss" : "text-foreground"}`}>
                {value}
              </p>
            )}
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg bg-primary/10 flex-shrink-0 ml-3">
            <Icon size={16} className="text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function fmtPrice(v: number) {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}
function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
function fmtUsd(v: number) { return `${v >= 0 ? "+" : ""}$${Math.abs(v).toFixed(2)}`; }

// ── OFI Gauge ──────────────────────────────────────────────────────────────

function OFIGauge({ value, label }: { value: number; label: string }) {
  // value: -1 to +1
  const clamp = Math.max(-1, Math.min(1, value));
  const pct = ((clamp + 1) / 2) * 100; // 0–100
  const isPositive = clamp >= 0;
  const color = clamp > 0.3 ? "hsl(160 100% 45%)" : clamp < -0.3 ? "hsl(0 72% 55%)" : "hsl(38 100% 60%)";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="font-mono font-bold" style={{ color }}>{clamp >= 0 ? "+" : ""}{clamp.toFixed(3)}</span>
      </div>
      {/* Track */}
      <div className="relative h-3 rounded-full bg-accent overflow-hidden">
        {/* Negative side (left) */}
        {clamp < 0 && (
          <div
            className="absolute top-0 bottom-0 right-1/2 rounded-l-full transition-all duration-300"
            style={{ width: `${Math.abs(clamp) * 50}%`, background: "hsl(0 72% 55%)", right: "50%" }}
          />
        )}
        {/* Positive side (right) */}
        {clamp > 0 && (
          <div
            className="absolute top-0 bottom-0 left-1/2 rounded-r-full transition-all duration-300"
            style={{ width: `${clamp * 50}%`, background: "hsl(160 100% 45%)" }}
          />
        )}
        {/* Center line */}
        <div className="absolute top-0 bottom-0 w-px bg-border" style={{ left: "50%" }} />
        {/* Cursor */}
        <div
          className="absolute top-0 bottom-0 w-1 rounded-full transition-all duration-200"
          style={{ left: `calc(${pct}% - 2px)`, background: color, boxShadow: `0 0 6px ${color}` }}
        />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>SELL PRESSURE</span>
        <span>NEUTRAL</span>
        <span>BUY PRESSURE</span>
      </div>
    </div>
  );
}

// ── Order Book Depth Ladder ────────────────────────────────────────────────

function OrderBookLadder({ book }: { book: OrderBook | null }) {
  if (!book) {
    return (
      <div className="flex items-center justify-center h-40 text-xs text-muted-foreground">
        Waiting for order book data...
      </div>
    );
  }

  const bids = book.bids.slice(0, 8);
  const asks = book.asks.slice(0, 8).reverse(); // show asks top-down (best at bottom)
  const maxQty = Math.max(
    ...bids.map(b => b.qty),
    ...asks.map(a => a.qty),
  );

  return (
    <div className="font-mono text-[11px] space-y-0">
      {/* Asks (sells) */}
      {asks.map((ask, i) => (
        <div key={`ask-${i}`} className="relative flex items-center justify-between px-3 py-[3px] group">
          <div
            className="absolute inset-y-0 right-0 opacity-20"
            style={{ width: `${(ask.qty / maxQty) * 100}%`, background: "hsl(0 72% 55%)" }}
          />
          <span className="relative loss z-10">{ask.price.toLocaleString("en-US", { maximumFractionDigits: 1 })}</span>
          <span className="relative text-muted-foreground z-10">{ask.qty.toFixed(3)}</span>
        </div>
      ))}
      {/* Mid-price divider */}
      {book.bids[0] && book.asks[0] && (
        <div className="flex items-center justify-between px-3 py-1 bg-accent/40 border-y border-primary/20">
          <span className="text-primary font-bold">
            {(((book.bids[0].price + book.asks[0].price) / 2)).toLocaleString("en-US", { maximumFractionDigits: 1 })}
          </span>
          <span className="text-muted-foreground text-[9px] uppercase tracking-wider">Mid</span>
        </div>
      )}
      {/* Bids (buys) */}
      {bids.map((bid, i) => (
        <div key={`bid-${i}`} className="relative flex items-center justify-between px-3 py-[3px]">
          <div
            className="absolute inset-y-0 left-0 opacity-20"
            style={{ width: `${(bid.qty / maxQty) * 100}%`, background: "hsl(160 100% 45%)" }}
          />
          <span className="relative gain z-10">{bid.price.toLocaleString("en-US", { maximumFractionDigits: 1 })}</span>
          <span className="relative text-muted-foreground z-10">{bid.qty.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Latency Dot ───────────────────────────────────────────────────────────

function LatencyDot({ quality, ms }: { quality: "green" | "yellow" | "red"; ms: number | null }) {
  const colors = { green: "bg-green-400", yellow: "bg-yellow-400", red: "bg-red-500" };
  const textColors = { green: "text-green-400", yellow: "text-yellow-400", red: "text-red-400" };
  const labels = { green: "Excellent", yellow: "Moderate", red: "High" };

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${colors[quality]} ${quality === "red" ? "animate-pulse" : ""}`} />
      <span className={`text-xs font-mono font-semibold ${textColors[quality]}`}>
        {ms != null ? `${ms.toFixed(0)}ms` : "—ms"}
      </span>
      <span className="text-xs text-muted-foreground">{labels[quality]} latency</span>
    </div>
  );
}

// ── Execution Quality Badge ────────────────────────────────────────────────

function ExecQualityBadge({ quality }: { quality: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    excellent: { bg: "bg-green-400/10 border-green-400/30", text: "text-green-400", label: "EXCELLENT" },
    good:      { bg: "bg-primary/10 border-primary/30",     text: "text-primary",   label: "GOOD" },
    poor:      { bg: "bg-yellow-400/10 border-yellow-400/30", text: "text-yellow-400", label: "POOR" },
    avoid:     { bg: "bg-red-500/10 border-red-500/30",     text: "text-red-400",   label: "AVOID" },
  };
  const s = map[quality] ?? map.good;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${s.bg} ${s.text}`}>
      {quality === "excellent" && <span>▲</span>}
      {quality === "avoid" && <span>✕</span>}
      {s.label}
    </span>
  );
}

// ── Custom Tooltips ────────────────────────────────────────────────────────

function CandleTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-lg min-w-[160px]">
      <p className="text-muted-foreground mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4"><span className="text-muted-foreground">Close</span><span className="font-mono font-medium">{fmtPrice(d.close)}</span></div>
        {d.ema9 && <div className="flex justify-between gap-4"><span style={{color:"hsl(271 91% 65%)"}}>EMA9</span><span className="font-mono">{fmtPrice(d.ema9)}</span></div>}
        {d.ema21 && <div className="flex justify-between gap-4"><span style={{color:"hsl(38 100% 60%)"}}>EMA21</span><span className="font-mono">{fmtPrice(d.ema21)}</span></div>}
        {d.rsi != null && <div className="flex justify-between gap-4"><span className="text-muted-foreground">RSI</span><span className="font-mono">{d.rsi.toFixed(1)}</span></div>}
        {d.signal && (
          <div className="flex justify-between gap-4 pt-1 border-t border-border mt-1">
            <span className="text-muted-foreground">Signal</span>
            <span className={d.signal === "buy" ? "gain font-bold uppercase" : "loss font-bold uppercase"}>{d.signal}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function EquityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-mono font-bold text-foreground">${d.totalValue?.toFixed(2)}</p>
      <p className={`font-mono ${d.realizedPnl >= 0 ? "gain" : "loss"}`}>{fmtUsd(d.realizedPnl)} P&L</p>
    </div>
  );
}

// ── OFI History Tooltip ────────────────────────────────────────────────────

function OFITooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-lg">
      <p className="text-muted-foreground mb-1">{label}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">OFI</span>
          <span className={`font-mono font-bold ${d.ofiSmooth >= 0 ? "gain" : "loss"}`}>{d.ofiSmooth?.toFixed(3)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Aggression</span>
          <span className="font-mono">{d.aggressionScore?.toFixed(1)}%</span>
        </div>
        {d.momentumIgnition && (
          <div className="text-yellow-400 font-bold pt-1">⚡ MOMENTUM IGNITION</div>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────

export default function Dashboard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const wsRef = useRef<WebSocket | null>(null);
  const [liveOFI, setLiveOFI] = useState<OFISummary | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const { data: config, isLoading: configLoading } = useQuery<BotConfig>({ queryKey: ["/api/config"], refetchInterval: 3000 });
  const { data: stats, isLoading: statsLoading } = useQuery<Stats>({ queryKey: ["/api/stats"], refetchInterval: 5000 });
  const { data: portfolio } = useQuery<LatestPortfolio>({ queryKey: ["/api/portfolio/latest"], refetchInterval: 5000 });
  const { data: snapshots } = useQuery<PortfolioSnapshot[]>({ queryKey: ["/api/portfolio/snapshots"], refetchInterval: 10000 });
  const { data: candles } = useQuery<PriceCandle[]>({ queryKey: ["/api/candles/BTC"], refetchInterval: 30000 });
  const { data: livePrice } = useQuery<LivePrice>({
    queryKey: ["/api/price/BTC"],
    refetchInterval: 15000,
    enabled: !!(config?.symbol),
  });
  const { data: recentTrades } = useQuery<Trade[]>({ queryKey: ["/api/trades"], refetchInterval: 5000 });
  const { data: ofiSummary } = useQuery<OFISummary>({ queryKey: ["/api/orderflow/summary"], refetchInterval: 1000 });
  const { data: ofiHistory } = useQuery<OFIHistoryItem[]>({ queryKey: ["/api/orderflow/ofi"], refetchInterval: 2000 });
  const { data: orderBook } = useQuery<OrderBook>({ queryKey: ["/api/orderflow/book"], refetchInterval: 500 });

  // WebSocket for real-time OFI streaming
  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//__PORT_5000__/ws`;
    let ws: WebSocket;
    let reconnectTimer: any;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => setWsConnected(true);
        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === "ofi" && msg.data) setLiveOFI(msg.data);
          } catch {}
        };
      } catch {}
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const activeOFI = liveOFI ?? ofiSummary ?? null;

  const simulateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/simulate", { symbol: config?.symbol ?? "BTC" }),
    onSuccess: () => {
      toast({ title: "Simulation complete", description: "Historical data processed and trades simulated." });
      qc.invalidateQueries();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bot/start"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/config"] }); },
  });

  const stopMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/bot/stop"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/config"] }); },
  });

  const isRunning = config?.isRunning ?? false;

  // Chart data
  const chartData = (candles ?? []).map(c => ({
    time: format(new Date(c.timestamp), "MMM d HH:mm"),
    close: c.close, ema9: c.ema9, ema21: c.ema21,
    rsi: c.rsi, macd: c.macd, macdSignal: c.macdSignal,
    macdHistogram: c.macdHistogram, signal: c.signal, volume: c.volume,
  }));

  const buyPoints = chartData.filter(d => d.signal === "buy");
  const sellPoints = chartData.filter(d => d.signal === "sell");

  const equityData = (snapshots ?? []).map(s => ({
    time: format(new Date(s.timestamp), "MMM d"),
    totalValue: s.totalValue, realizedPnl: s.realizedPnl, drawdown: s.drawdown,
  }));

  // OFI chart data
  const ofiChartData = (ofiHistory ?? []).slice(-80).map(s => ({
    time: format(new Date(s.timestamp), "HH:mm:ss"),
    ofiSmooth: +s.ofiSmooth.toFixed(3),
    aggressionScore: s.aggressionScore,
    momentumIgnition: s.momentumIgnition ? 0.9 : null,
  }));

  const hasData = (candles?.length ?? 0) > 0;

  return (
    <div className="p-5 space-y-4 min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {config?.demoMode ? "Demo Mode — real BTC prices, simulated money" : "Live Trading"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Live price */}
          {livePrice && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent border border-border text-sm">
              <span className="text-muted-foreground font-mono text-xs">{livePrice.symbol}/USDT</span>
              <span className="font-bold font-mono text-foreground tabular">{fmtPrice(livePrice.price)}</span>
              <span className={`font-mono text-xs ${livePrice.change24h >= 0 ? "gain" : "loss"}`}>
                {fmtPct(livePrice.change24h)}
              </span>
            </div>
          )}
          {/* WS status */}
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border ${wsConnected ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-border text-muted-foreground"}`}>
            {wsConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
            <span>{wsConnected ? "Live" : "Polling"}</span>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => simulateMutation.mutate()}
            disabled={simulateMutation.isPending}
            data-testid="button-simulate"
            className="border-border text-xs"
          >
            <RefreshCw size={13} className={simulateMutation.isPending ? "animate-spin" : ""} />
            {simulateMutation.isPending ? "Running..." : "Run Sim"}
          </Button>
          {isRunning ? (
            <Button size="sm" variant="destructive" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending} data-testid="button-stop" className="text-xs">
              <Square size={13} /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending} data-testid="button-start" className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs">
              <Play size={13} /> Start Bot
            </Button>
          )}
        </div>
      </div>

      {/* No data banner */}
      {!hasData && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
          <AlertTriangle size={16} />
          <span>No data yet — click <strong>Run Sim</strong> to pull 90 days of real {config?.symbol ?? "BTC"} prices and see exactly what Beelzebub would have traded.</span>
        </div>
      )}

      {/* ── OFI Intelligence Row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* OFI Gauge + signals */}
        <Card className="border-border bg-card lg:col-span-1">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity size={14} className="text-primary" />
                Order Flow Intelligence
              </CardTitle>
              {activeOFI && <ExecQualityBadge quality={activeOFI.executionQuality} />}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {activeOFI ? (
              <>
                <OFIGauge value={activeOFI.ofi} label="OFI Score (smoothed)" />

                {/* Latency */}
                <LatencyDot
                  quality={activeOFI.latencyQuality}
                  ms={activeOFI.latencyMs}
                />

                {/* Momentum ignition alert */}
                {activeOFI.momentumIgnition && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 text-xs font-bold animate-pulse">
                    <Zap size={13} />
                    MOMENTUM IGNITION — {activeOFI.momentumDirection?.toUpperCase()} detected
                  </div>
                )}

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Spread</p>
                    <p className="font-mono font-semibold text-foreground">{activeOFI.spreadBps.toFixed(2)} bps</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Aggression</p>
                    <p className={`font-mono font-semibold ${activeOFI.aggressionScore > 60 ? "gain" : activeOFI.aggressionScore < 40 ? "loss" : "text-foreground"}`}>
                      {activeOFI.aggressionScore.toFixed(1)}%
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Depth Ratio</p>
                    <p className="font-mono font-semibold text-foreground">{(activeOFI.depthRatio * 100).toFixed(1)}% bid</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-muted-foreground">Mid Price</p>
                    <p className="font-mono font-semibold text-foreground">{fmtPrice(activeOFI.midPrice)}</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
          </CardContent>
        </Card>

        {/* OFI History Chart */}
        <Card className="border-border bg-card lg:col-span-1">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">OFI History</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            {ofiChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={150}>
                <ComposedChart data={ofiChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis hide />
                  <YAxis domain={[-1, 1]} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={28} tickFormatter={v => v.toFixed(1)} />
                  <Tooltip content={<OFITooltip />} />
                  {/* Zero line */}
                  <ReferenceDot x={ofiChartData[0]?.time} y={0} r={0} />
                  <Area
                    type="monotone" dataKey="ofiSmooth"
                    fill="hsl(var(--primary) / 0.1)" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false}
                  />
                  {/* Momentum ignition markers */}
                  <Line type="monotone" dataKey="momentumIgnition" stroke="hsl(38 100% 60%)" strokeWidth={0} dot={(props: any) => {
                    if (!props.payload?.momentumIgnition) return <g key={props.key} />;
                    return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill="hsl(38 100% 60%)" stroke="hsl(var(--background))" strokeWidth={2} />;
                  }} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[150px] flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            )}
            <div className="flex items-center gap-4 px-2 pt-2 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 inline-block rounded" style={{background:"hsl(160 100% 45%)"}} />OFI</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{background:"hsl(38 100% 60%)"}} />Momentum Ignition</span>
            </div>
          </CardContent>
        </Card>

        {/* Live Order Book */}
        <Card className="border-border bg-card lg:col-span-1">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Order Book</CardTitle>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block rounded-sm opacity-40" style={{background:"hsl(0 72% 55%)"}} />Ask</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 inline-block rounded-sm opacity-40" style={{background:"hsl(160 100% 45%)"}} />Bid</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0 pb-3">
            <OrderBookLadder book={orderBook ?? null} />
          </CardContent>
        </Card>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Portfolio Value" loading={statsLoading}
          value={`$${(portfolio?.totalValue ?? stats?.initialCapital ?? 10000).toFixed(2)}`}
          sub={`Started $${stats?.initialCapital?.toFixed(0) ?? "10,000"}`}
          positive={null} icon={DollarSign}
        />
        <KpiCard
          title="Total Return" loading={statsLoading}
          value={fmtPct(stats?.totalReturn ?? 0)}
          sub={fmtUsd(stats?.totalPnl ?? 0) + " P&L"}
          positive={(stats?.totalReturn ?? 0) >= 0} icon={TrendingUp}
        />
        <KpiCard
          title="Win Rate" loading={statsLoading}
          value={`${(stats?.winRate ?? 0).toFixed(1)}%`}
          sub={`${stats?.wins ?? 0}W / ${stats?.losses ?? 0}L (${stats?.totalTrades ?? 0} total)`}
          positive={(stats?.winRate ?? 0) >= 50} icon={Target}
        />
        <KpiCard
          title="Sharpe Ratio" loading={statsLoading}
          value={(stats?.sharpe ?? 0).toFixed(2)}
          sub={`Max DD ${(stats?.maxDrawdown ?? 0).toFixed(1)}%`}
          positive={(stats?.sharpe ?? 0) > 1} icon={Zap}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard title="Profit Factor" loading={statsLoading} value={(stats?.profitFactor ?? 0).toFixed(2)} sub="Win/Loss ratio" positive={(stats?.profitFactor ?? 0) > 1} icon={TrendingUp} />
        <KpiCard title="Avg Win" loading={statsLoading} value={fmtUsd(stats?.avgWin ?? 0)} sub="Per winning trade" positive icon={TrendingUp} />
        <KpiCard title="Avg Loss" loading={statsLoading} value={fmtUsd(stats?.avgLoss ?? 0)} sub="Per losing trade" positive={false} icon={TrendingDown} />
        <KpiCard title="Max Drawdown" loading={statsLoading} value={`${(stats?.maxDrawdown ?? 0).toFixed(2)}%`} sub="Peak to trough" positive={(stats?.maxDrawdown ?? 0) < 10} icon={AlertTriangle} />
      </div>

      {/* Main Price Chart */}
      {hasData && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-foreground">{config?.symbol ?? "BTC"}/USDT — Simulation Price History (EMA + Signals)</CardTitle>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded" style={{background:"hsl(271 91% 65%)"}} />EMA 9</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded" style={{background:"hsl(38 100% 60%)"}} />EMA 21</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{background:"hsl(var(--color-gain))"}} />Buy</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{background:"hsl(var(--color-loss))"}} />Sell</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} interval={Math.floor(chartData.length / 8)} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v.toFixed(0)}`} width={60} />
                <Tooltip content={<CandleTooltip />} />
                <Area type="monotone" dataKey="close" fill="hsl(var(--primary) / 0.06)" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} name="Price" />
                <Line type="monotone" dataKey="ema9" stroke="hsl(271 91% 65%)" strokeWidth={1.5} dot={false} name="EMA9" />
                <Line type="monotone" dataKey="ema21" stroke="hsl(38 100% 60%)" strokeWidth={1.5} dot={false} name="EMA21" />
                {buyPoints.map((pt, i) => (
                  <ReferenceDot key={`buy-${i}`} x={pt.time} y={pt.close} r={5} fill="hsl(var(--color-gain))" stroke="hsl(var(--background))" strokeWidth={2} />
                ))}
                {sellPoints.map((pt, i) => (
                  <ReferenceDot key={`sell-${i}`} x={pt.time} y={pt.close} r={5} fill="hsl(var(--color-loss))" stroke="hsl(var(--background))" strokeWidth={2} />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Bottom row: Equity Curve + RSI/MACD + Recent Trades */}
      {hasData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Equity Curve */}
          <Card className="border-border bg-card lg:col-span-1">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Equity Curve</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={equityData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} tickLine={false} interval={Math.floor(equityData.length / 4)} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(1)}k`} width={45} domain={['auto', 'auto']} />
                  <Tooltip content={<EquityTooltip />} />
                  <Area type="monotone" dataKey="totalValue" fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* RSI + MACD */}
          <Card className="border-border bg-card lg:col-span-1">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">RSI</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-2">
              <ResponsiveContainer width="100%" height={65}>
                <LineChart data={chartData.slice(-60)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis hide />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={25} />
                  <Line type="monotone" dataKey="rsi" stroke="hsl(200 100% 60%)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
            <CardHeader className="pb-2 pt-2 px-4">
              <CardTitle className="text-sm font-semibold">MACD</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <ResponsiveContainer width="100%" height={65}>
                <ComposedChart data={chartData.slice(-60)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis hide />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} width={35} tickFormatter={v => v.toFixed(0)} />
                  <Bar dataKey="macdHistogram" fill="hsl(var(--primary) / 0.4)" radius={[1,1,0,0]} />
                  <Line type="monotone" dataKey="macd" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="macdSignal" stroke="hsl(0 72% 55%)" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Recent Trades */}
          <Card className="border-border bg-card lg:col-span-1">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Recent Trades</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              <div className="overflow-y-auto max-h-[190px]">
                {(recentTrades ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground px-4">No trades yet.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card border-b border-border">
                      <tr>
                        <th className="px-4 py-1.5 text-left text-muted-foreground font-medium">Side</th>
                        <th className="px-2 py-1.5 text-right text-muted-foreground font-medium">Entry</th>
                        <th className="px-2 py-1.5 text-right text-muted-foreground font-medium">P&L</th>
                        <th className="px-3 py-1.5 text-right text-muted-foreground font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(recentTrades ?? []).slice(0, 20).map(t => (
                        <tr key={t.id} className="border-b border-border/50 hover:bg-accent/50" data-testid={`row-trade-${t.id}`}>
                          <td className="px-4 py-1.5">
                            <span className={`font-bold uppercase text-[10px] ${t.side === "buy" ? "gain" : "loss"}`}>{t.side}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono">{fmtPrice(t.entryPrice)}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${(t.pnl ?? 0) >= 0 ? "gain" : "loss"}`}>
                            {t.pnl != null ? (t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.status === "open" ? "signal-buy" : t.closeReason === "take_profit" ? "gain" : t.closeReason === "stop_loss" ? "loss" : "text-muted-foreground"}`}>
                              {t.status === "open" ? "Open" : t.closeReason ?? "closed"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
