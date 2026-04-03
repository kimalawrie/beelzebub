import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, ReferenceLine,
} from "recharts";
import type { Trade } from "@shared/schema";

function fmtPrice(v: number) {
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}
function fmtPct(v: number | null) { if (v == null) return "—"; return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`; }
function fmtUsd(v: number | null) { if (v == null) return "—"; return `${v >= 0 ? "+" : "-"}$${Math.abs(v).toFixed(2)}`; }

const closeReasonLabel: Record<string, string> = {
  take_profit: "TP",
  stop_loss: "SL",
  signal: "Signal",
  manual: "Manual",
};

export default function Trades() {
  const [filter, setFilter] = useState<"all" | "wins" | "losses" | "open">("all");
  const { data: allTrades = [], isLoading } = useQuery<Trade[]>({
    queryKey: ["/api/trades"],
    refetchInterval: 5000,
  });

  const filtered = allTrades.filter(t => {
    if (filter === "wins") return t.status === "closed" && (t.pnl ?? 0) > 0;
    if (filter === "losses") return t.status === "closed" && (t.pnl ?? 0) <= 0;
    if (filter === "open") return t.status === "open";
    return true;
  });

  const closed = allTrades.filter(t => t.status === "closed");
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);

  // P&L per trade bar chart
  const pnlData = closed.slice().reverse().slice(0, 50).map((t, i) => ({
    i: i + 1,
    pnl: t.pnl ?? 0,
    label: fmtUsd(t.pnl),
  }));

  // Cumulative P&L line
  const cumData: { i: number; cum: number }[] = [];
  let cum = 0;
  closed.slice().reverse().forEach((t, i) => {
    cum += t.pnl ?? 0;
    cumData.push({ i: i + 1, cum });
  });

  // Win/loss distribution
  const wins = closed.filter(t => (t.pnl ?? 0) > 0).length;
  const losses = closed.filter(t => (t.pnl ?? 0) <= 0).length;
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;

  return (
    <div className="p-5 space-y-4">
      {/* Demo mode banner */}
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/5 border border-primary/20 text-xs">
        <span className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />
        <span className="text-muted-foreground">Demo Mode — <span className="text-foreground font-medium">real market prices</span>, simulated money. Nothing here cost a penny.</span>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">Beelzebub’s Trades</h1>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-muted-foreground">{allTrades.length} trades · {wins}W / {losses}L · {winRate.toFixed(1)}% win rate</span>
            <span className={`text-sm font-bold font-mono tabular ${totalPnl >= 0 ? "gain" : "loss"}`}>
              {totalPnl >= 0 ? "+" : ""}{fmtUsd(totalPnl)} total P&L
            </span>
          </div>
        </div>
        {/* Filter tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg text-xs">
          {(["all", "wins", "losses", "open"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded capitalize font-medium transition-colors ${filter === f ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              data-testid={`filter-${f}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Charts row */}
      {closed.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* P&L per trade */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">P&L per Trade</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={pnlData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="i" tick={{ fontSize: 9 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={50} />
                  <Tooltip
                    formatter={(v: number) => [fmtUsd(v), "P&L"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1} />
                  <Bar dataKey="pnl" radius={[2,2,0,0]}>
                    {pnlData.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? "hsl(160 100% 45%)" : "hsl(0 72% 55%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Cumulative P&L */}
          <Card className="border-border bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Cumulative P&L</CardTitle>
            </CardHeader>
            <CardContent className="px-2 pb-4">
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={cumData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="i" tick={{ fontSize: 9 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v.toFixed(0)}`} width={55} />
                  <Tooltip
                    formatter={(v: number) => [`$${v.toFixed(2)}`, "Cum. P&L"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" />
                  <Line type="monotone" dataKey="cum" stroke={cumData.length > 0 && cumData[cumData.length-1].cum >= 0 ? "hsl(160 100% 45%)" : "hsl(0 72% 55%)"}
                    strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Trades table */}
      <Card className="border-border bg-card">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr>
                  <th className="px-4 py-3 text-left text-muted-foreground font-medium">#</th>
                  <th className="px-3 py-3 text-left text-muted-foreground font-medium">Side</th>
                  <th className="px-3 py-3 text-right text-muted-foreground font-medium">Entry Price</th>
                  <th className="px-3 py-3 text-right text-muted-foreground font-medium">Exit Price</th>
                  <th className="px-3 py-3 text-right text-muted-foreground font-medium">Qty</th>
                  <th className="px-3 py-3 text-right text-muted-foreground font-medium">P&L</th>
                  <th className="px-3 py-3 text-right text-muted-foreground font-medium">P&L %</th>
                  <th className="px-3 py-3 text-left text-muted-foreground font-medium">Entry Time</th>
                  <th className="px-3 py-3 text-center text-muted-foreground font-medium">Reason</th>
                  <th className="px-3 py-3 text-center text-muted-foreground font-medium">RSI</th>
                  <th className="px-4 py-3 text-center text-muted-foreground font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      {Array.from({ length: 11 }).map((_, j) => (
                        <td key={j} className="px-3 py-2.5"><div className="h-3 bg-muted rounded animate-pulse w-16" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">No trades found.</td></tr>
                ) : (
                  filtered.map((t, idx) => (
                    <tr key={t.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors" data-testid={`row-trade-${t.id}`}>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono">{allTrades.length - allTrades.indexOf(t)}</td>
                      <td className="px-3 py-2.5">
                        <span className={`font-bold uppercase text-[10px] px-1.5 py-0.5 rounded ${t.side === "buy" ? "signal-buy" : "signal-sell"}`}>{t.side}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular">{fmtPrice(t.entryPrice)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular text-muted-foreground">{t.exitPrice ? fmtPrice(t.exitPrice) : "—"}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular text-muted-foreground">{t.quantity.toFixed(5)}</td>
                      <td className={`px-3 py-2.5 text-right font-mono tabular font-semibold ${(t.pnl ?? 0) >= 0 ? "gain" : "loss"}`}>
                        {fmtUsd(t.pnl)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono tabular ${(t.pnlPercent ?? 0) >= 0 ? "gain" : "loss"}`}>
                        {fmtPct(t.pnlPercent)}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground font-mono">{format(new Date(t.entryTime), "MMM d HH:mm")}</td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground">
                        {t.closeReason ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.closeReason === "take_profit" ? "gain bg-green-500/10" : t.closeReason === "stop_loss" ? "loss bg-red-500/10" : "text-muted-foreground bg-muted"}`}>
                            {closeReasonLabel[t.closeReason] ?? t.closeReason}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-center font-mono tabular text-muted-foreground">
                        {t.rsiAtEntry != null ? (
                          <span className={t.rsiAtEntry > 70 ? "loss" : t.rsiAtEntry < 30 ? "gain" : ""}>{t.rsiAtEntry.toFixed(1)}</span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${t.status === "open" ? "signal-buy" : "text-muted-foreground bg-muted"}`}>
                          {t.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
