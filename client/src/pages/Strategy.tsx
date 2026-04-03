import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Zap, TrendingUp, TrendingDown, Minus, Flame, Scan, Crown } from "lucide-react";

interface CoinRanking {
  symbol: string;
  displayName: string;
  ofiScore: number;
  ofiDirection: "buy" | "sell" | "neutral";
  spreadBps: number;
  aggressionScore: number;
  executionQuality: string;
  momentumIgnition: boolean;
  momentumDirection: "up" | "down" | null;
  midPrice: number;
  depthRatio: number;
  latencyMs: number | null;
  signalStrength: number;
  rank: number;
}

function fmtPrice(v: number) {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function ExecBadge({ quality }: { quality: string }) {
  const map: Record<string, string> = {
    excellent: "bg-green-400/10 text-green-400 border-green-400/30",
    good: "bg-primary/10 text-primary border-primary/30",
    poor: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
    avoid: "bg-red-500/10 text-red-400 border-red-500/30",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-wider ${map[quality] ?? map.good}`}>
      {quality}
    </span>
  );
}

function DirectionIcon({ dir }: { dir: "buy" | "sell" | "neutral" }) {
  if (dir === "buy") return <TrendingUp size={12} className="text-green-400" />;
  if (dir === "sell") return <TrendingDown size={12} className="text-red-400" />;
  return <Minus size={12} className="text-muted-foreground" />;
}

function SignalBar({ value }: { value: number }) {
  const color = value > 70 ? "hsl(160 100% 45%)" : value > 40 ? "hsl(38 100% 60%)" : "hsl(var(--muted-foreground))";
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-accent overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono font-bold tabular w-7 text-right" style={{ color }}>{value.toFixed(0)}</span>
    </div>
  );
}

export default function Strategy() {
  const { data: rankings = [], isLoading } = useQuery<CoinRanking[]>({
    queryKey: ["/api/scanner/rankings"],
    refetchInterval: 1500,
  });

  const best = rankings.length > 0 ? rankings[0] : null;
  const momentum = rankings.filter(r => r.momentumIgnition);

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Scan size={18} className="text-primary" />
          <h1 className="text-lg font-bold text-foreground">Multi-Coin Scanner</h1>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold border border-primary/20">
            {rankings.length} LIVE
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          Scanning top 20 coins simultaneously. Beelzebub trades whichever has the strongest order flow signal.
        </p>
      </div>

      {/* Best coin highlight */}
      {best && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Crown size={18} className="text-primary" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Beelzebub's Current Pick</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xl font-bold text-foreground">{best.displayName}/USDT</span>
                    <DirectionIcon dir={best.ofiDirection} />
                    <span className={`text-sm font-mono font-bold ${best.ofiDirection === "buy" ? "gain" : best.ofiDirection === "sell" ? "loss" : "text-muted-foreground"}`}>
                      {best.ofiDirection.toUpperCase()}
                    </span>
                    {best.momentumIgnition && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 text-[10px] font-bold animate-pulse">
                        <Flame size={10} /> IGNITION
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right space-y-1">
                <div className="text-xs text-muted-foreground">Signal Strength</div>
                <div className="text-2xl font-bold font-mono tabular text-primary">{best.signalStrength.toFixed(0)}</div>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-3 mt-3 pt-3 border-t border-primary/20 text-xs">
              <div>
                <span className="text-muted-foreground">OFI</span>
                <div className={`font-mono font-bold ${best.ofiScore >= 0 ? "gain" : "loss"}`}>{best.ofiScore >= 0 ? "+" : ""}{best.ofiScore.toFixed(3)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Spread</span>
                <div className="font-mono font-semibold text-foreground">{best.spreadBps.toFixed(2)} bps</div>
              </div>
              <div>
                <span className="text-muted-foreground">Aggression</span>
                <div className="font-mono font-semibold text-foreground">{best.aggressionScore.toFixed(1)}%</div>
              </div>
              <div>
                <span className="text-muted-foreground">Price</span>
                <div className="font-mono font-semibold text-foreground">{fmtPrice(best.midPrice)}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Exec Quality</span>
                <div className="mt-0.5"><ExecBadge quality={best.executionQuality} /></div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Momentum alerts */}
      {momentum.length > 0 && (
        <div className="space-y-2">
          {momentum.map(m => (
            <div key={m.symbol} className="flex items-center gap-3 p-3 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 text-xs">
              <Flame size={14} className="animate-pulse flex-shrink-0" />
              <span className="font-bold">{m.displayName}</span>
              <span>MOMENTUM IGNITION {m.momentumDirection?.toUpperCase()} — OFI {m.ofiScore >= 0 ? "+" : ""}{m.ofiScore.toFixed(3)}, Signal {m.signalStrength.toFixed(0)}/100</span>
            </div>
          ))}
        </div>
      )}

      {/* Full leaderboard */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Live Coin Rankings</CardTitle>
            <span className="text-[10px] text-muted-foreground">Ranked by composite OFI signal strength</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 text-left text-muted-foreground font-medium w-10">#</th>
                  <th className="px-3 py-2.5 text-left text-muted-foreground font-medium">Coin</th>
                  <th className="px-3 py-2.5 text-center text-muted-foreground font-medium">Direction</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium">OFI</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium">Signal</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium">Spread</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium">Aggression</th>
                  <th className="px-3 py-2.5 text-right text-muted-foreground font-medium">Price</th>
                  <th className="px-3 py-2.5 text-center text-muted-foreground font-medium">Exec</th>
                  <th className="px-4 py-2.5 text-center text-muted-foreground font-medium">Alerts</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} className="px-3 py-2.5"><Skeleton className="h-3 w-16" /></td>
                      ))}
                    </tr>
                  ))
                ) : rankings.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Scanners warming up...</td></tr>
                ) : (
                  rankings.map((coin, idx) => (
                    <tr
                      key={coin.symbol}
                      className={`border-b border-border/50 transition-colors ${idx === 0 ? "bg-primary/5" : "hover:bg-accent/50"}`}
                      data-testid={`row-coin-${coin.displayName}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className={`font-mono font-bold ${idx === 0 ? "text-primary" : idx < 3 ? "text-foreground" : "text-muted-foreground"}`}>
                          {coin.rank}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`font-semibold ${idx === 0 ? "text-primary" : "text-foreground"}`}>
                          {coin.displayName}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <DirectionIcon dir={coin.ofiDirection} />
                          <span className={`font-mono text-[10px] font-bold uppercase ${coin.ofiDirection === "buy" ? "gain" : coin.ofiDirection === "sell" ? "loss" : "text-muted-foreground"}`}>
                            {coin.ofiDirection}
                          </span>
                        </div>
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono tabular font-semibold ${coin.ofiScore >= 0 ? "gain" : "loss"}`}>
                        {coin.ofiScore >= 0 ? "+" : ""}{coin.ofiScore.toFixed(3)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <SignalBar value={coin.signalStrength} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular text-muted-foreground">
                        {coin.spreadBps.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono tabular ${coin.aggressionScore > 60 ? "gain" : coin.aggressionScore < 40 ? "loss" : "text-muted-foreground"}`}>
                        {coin.aggressionScore.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular text-muted-foreground">
                        {fmtPrice(coin.midPrice)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <ExecBadge quality={coin.executionQuality} />
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {coin.momentumIgnition ? (
                          <span className="flex items-center justify-center gap-1 text-yellow-400 font-bold animate-pulse">
                            <Zap size={10} /> IGN
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* How it works */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">How Beelzebub Picks</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-accent/50 space-y-1">
              <div className="text-primary font-bold">40%</div>
              <div className="text-muted-foreground">OFI Strength — how hard the book is tipping directionally</div>
            </div>
            <div className="p-2.5 rounded-lg bg-accent/50 space-y-1">
              <div className="text-primary font-bold">20%</div>
              <div className="text-muted-foreground">Spread — tighter spread = cheaper to execute</div>
            </div>
            <div className="p-2.5 rounded-lg bg-accent/50 space-y-1">
              <div className="text-primary font-bold">20%</div>
              <div className="text-muted-foreground">Aggression — how aggressively market orders are hitting</div>
            </div>
            <div className="p-2.5 rounded-lg bg-accent/50 space-y-1">
              <div className="text-primary font-bold">+20%</div>
              <div className="text-muted-foreground">Momentum Ignition — algo pump detected, bonus signal</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
