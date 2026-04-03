import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, ReferenceLine, BarChart, Bar,
} from "recharts";
import { format } from "date-fns";
import type { PortfolioSnapshot, Trade, BotConfig } from "@shared/schema";

function fmtUsd(v: number) { return `$${v.toFixed(2)}`; }
function fmtPct(v: number) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }

interface Stats {
  totalTrades: number; wins: number; losses: number; winRate: number;
  totalPnl: number; avgWin: number; avgLoss: number; profitFactor: number;
  maxDrawdown: number; totalReturn: number; sharpe: number;
  initialCapital: number; finalValue: number;
}

interface LatestPortfolio {
  totalValue: number; cashBalance: number; cryptoValue: number;
  realizedPnl: number; unrealizedPnl: number; drawdown: number;
}

const RADIAN = Math.PI / 180;
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) {
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="hsl(var(--foreground))" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {percent > 0.05 ? `${(percent * 100).toFixed(0)}%` : ""}
    </text>
  );
}

function StatRow({ label, value, positive }: { label: string; value: string; positive?: boolean | null }) {
  return (
    <div className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xs font-mono font-semibold tabular ${positive === true ? "gain" : positive === false ? "loss" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

export default function Portfolio() {
  const { data: config } = useQuery<BotConfig>({ queryKey: ["/api/config"] });
  const { data: portfolio } = useQuery<LatestPortfolio>({ queryKey: ["/api/portfolio/latest"], refetchInterval: 5000 });
  const { data: snapshots = [] } = useQuery<PortfolioSnapshot[]>({ queryKey: ["/api/portfolio/snapshots"], refetchInterval: 10000 });
  const { data: stats } = useQuery<Stats>({ queryKey: ["/api/stats"], refetchInterval: 5000 });
  const { data: trades = [] } = useQuery<Trade[]>({ queryKey: ["/api/trades"] });

  const initialCapital = config?.initialCapital ?? 10000;
  const totalValue = portfolio?.totalValue ?? initialCapital;
  const cashBalance = portfolio?.cashBalance ?? totalValue;
  const cryptoValue = portfolio?.cryptoValue ?? 0;
  const totalPnl = stats?.totalPnl ?? 0;

  const pieData = [
    { name: "Cash", value: cashBalance, color: "hsl(215 8% 50%)" },
    { name: config?.symbol ?? "BTC", value: cryptoValue, color: "hsl(160 100% 45%)" },
  ].filter(d => d.value > 0);

  const equityData = snapshots.map(s => ({
    time: format(new Date(s.timestamp), "MMM d"),
    total: s.totalValue,
    cash: s.cashBalance,
    crypto: s.cryptoValue,
    drawdown: -s.drawdown,
    pnl: s.realizedPnl,
  }));

  // Monthly P&L breakdown
  const monthlyMap: Record<string, number> = {};
  trades.filter(t => t.status === "closed" && t.pnl != null).forEach(t => {
    const month = format(new Date(t.entryTime), "MMM yyyy");
    monthlyMap[month] = (monthlyMap[month] ?? 0) + (t.pnl ?? 0);
  });
  const monthlyData = Object.entries(monthlyMap).map(([month, pnl]) => ({ month, pnl }));

  return (
    <div className="p-5 space-y-4">
      <div>
        <h1 className="text-lg font-bold text-foreground">Beelzebub’s Portfolio</h1>
        <p className="text-xs text-muted-foreground">Demo mode — real {config?.symbol ?? "crypto"} prices, simulated capital. Full performance breakdown.</p>
      </div>

      {/* Top row: Total value + allocation + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Portfolio value card */}
        <Card className="border-border bg-card panel-hover border-primary/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Total Portfolio Value</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            <div>
              <p className="text-3xl font-bold tabular font-mono text-foreground">{fmtUsd(totalValue)}</p>
              <p className={`text-base font-mono font-semibold mt-1 ${totalPnl >= 0 ? "gain" : "loss"}`}>
                {totalPnl >= 0 ? "+" : ""}{fmtUsd(totalPnl)} ({fmtPct(stats?.totalReturn ?? 0)})
              </p>
              <p className="text-xs text-muted-foreground mt-1">Trading {config?.symbol ?? "—"}/USDT</p>
            </div>
            <div className="space-y-0">
              <StatRow label="Initial Capital" value={fmtUsd(initialCapital)} />
              <StatRow label="Cash Balance" value={fmtUsd(cashBalance)} />
              <StatRow label={`${config?.symbol ?? "BTC"} Value`} value={fmtUsd(cryptoValue)} />
              <StatRow label="Unrealized P&L" value={fmtUsd(portfolio?.unrealizedPnl ?? 0)} positive={(portfolio?.unrealizedPnl ?? 0) >= 0} />
              <StatRow label="Realized P&L" value={fmtUsd(portfolio?.realizedPnl ?? 0)} positive={(portfolio?.realizedPnl ?? 0) >= 0} />
              <StatRow label="Current Drawdown" value={`${(portfolio?.drawdown ?? 0).toFixed(2)}%`} positive={(portfolio?.drawdown ?? 0) < 5} />
            </div>
          </CardContent>
        </Card>

        {/* Allocation pie */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Allocation</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 flex flex-col items-center">
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65}
                      dataKey="value" labelLine={false} label={PieLabel}>
                      {pieData.map((d, i) => (
                        <Cell key={i} fill={d.color} stroke="hsl(var(--background))" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => [fmtUsd(v)]}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-2">
                  {pieData.map(d => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-mono font-medium text-foreground">{fmtUsd(d.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground py-8">Run simulation to see allocation.</p>
            )}
          </CardContent>
        </Card>

        {/* Performance stats */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Performance Stats</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-0">
            <StatRow label="Total Return" value={fmtPct(stats?.totalReturn ?? 0)} positive={(stats?.totalReturn ?? 0) >= 0} />
            <StatRow label="Sharpe Ratio" value={(stats?.sharpe ?? 0).toFixed(2)} positive={(stats?.sharpe ?? 0) > 1} />
            <StatRow label="Max Drawdown" value={`${(stats?.maxDrawdown ?? 0).toFixed(2)}%`} positive={(stats?.maxDrawdown ?? 0) < 10} />
            <StatRow label="Profit Factor" value={(stats?.profitFactor ?? 0).toFixed(2)} positive={(stats?.profitFactor ?? 0) > 1} />
            <StatRow label="Win Rate" value={`${(stats?.winRate ?? 0).toFixed(1)}%`} positive={(stats?.winRate ?? 0) >= 50} />
            <StatRow label="Total Trades" value={String(stats?.totalTrades ?? 0)} />
            <StatRow label="Avg Win" value={fmtUsd(stats?.avgWin ?? 0)} positive />
            <StatRow label="Avg Loss" value={fmtUsd(stats?.avgLoss ?? 0)} positive={false} />
          </CardContent>
        </Card>
      </div>

      {/* Equity curve + Drawdown */}
      {equityData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Portfolio Growth</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={equityData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(160 100% 45%)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(160 100% 45%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} tickLine={false} interval={Math.floor(equityData.length / 6)} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(1)}k`} width={45} />
                  <Tooltip
                    formatter={(v: number) => [fmtUsd(v)]}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <ReferenceLine y={initialCapital} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={1} />
                  <Area type="monotone" dataKey="total" fill="url(#gradTotal)" stroke="hsl(160 100% 45%)" strokeWidth={2} dot={false} name="Portfolio" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Drawdown */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Drawdown</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={equityData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradDD" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(0 72% 55%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(0 72% 55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="time" tick={{ fontSize: 9 }} tickLine={false} interval={Math.floor(equityData.length / 6)} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `${v.toFixed(0)}%`} width={40} />
                  <Tooltip
                    formatter={(v: number) => [`${(-v).toFixed(2)}%`, "Drawdown"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Area type="monotone" dataKey="drawdown" fill="url(#gradDD)" stroke="hsl(0 72% 55%)" strokeWidth={1.5} dot={false} name="Drawdown" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Monthly P&L */}
      {monthlyData.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Monthly P&L</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={monthlyData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={55} />
                <Tooltip
                  formatter={(v: number) => [fmtUsd(v), "P&L"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Bar dataKey="pnl" radius={[3,3,0,0]}>
                  {monthlyData.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? "hsl(160 100% 45%)" : "hsl(0 72% 55%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
