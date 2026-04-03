import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, Settings, TrendingUp, Shield } from "lucide-react";
import type { BotConfig } from "@shared/schema";

const PAIRS = [
  { symbol: "BTC", label: "BTC/USDT — Bitcoin" },
  { symbol: "ETH", label: "ETH/USDT — Ethereum" },
  { symbol: "SOL", label: "SOL/USDT — Solana" },
  { symbol: "BNB", label: "BNB/USDT — BNB" },
  { symbol: "ADA", label: "ADA/USDT — Cardano" },
  { symbol: "DOGE", label: "DOGE/USDT — Dogecoin" },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumInput({ value, onChange, min, max, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <Input
      type="number" value={value} min={min} max={max} step={step}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className="bg-muted border-border text-foreground font-mono text-xs h-8"
    />
  );
}

export default function Strategy() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: config, isLoading } = useQuery<BotConfig>({ queryKey: ["/api/config"] });

  const [form, setForm] = useState<Partial<BotConfig>>({});
  useEffect(() => { if (config) setForm(config); }, [config]);

  const set = (key: keyof BotConfig) => (val: any) => setForm(f => ({ ...f, [key]: val }));

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", "/api/config", form),
    onSuccess: () => {
      toast({ title: "Settings saved", description: "Bot configuration updated." });
      qc.invalidateQueries({ queryKey: ["/api/config"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const simulateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/simulate", { symbol: form.symbol ?? "BTC" }),
    onSuccess: () => {
      toast({ title: "Backtest complete", description: "Simulation ran on 90 days of data." });
      qc.invalidateQueries();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">Strategy Configuration</h1>
          <p className="text-xs text-muted-foreground">EMA Crossover + RSI filter + MACD confirmation</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => simulateMutation.mutate()} disabled={simulateMutation.isPending} className="text-xs border-border" data-testid="button-backtest">
            <RefreshCw size={13} className={simulateMutation.isPending ? "animate-spin" : ""} />
            {simulateMutation.isPending ? "Running..." : "Backtest"}
          </Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 text-xs" data-testid="button-save">
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Strategy explanation */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
            <TrendingUp size={14} /> How the Strategy Works
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div>
              <p className="text-foreground font-medium mb-1">📈 Buy Signal</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>EMA{form.emaFast} crosses above EMA{form.emaSlow}</li>
                <li>RSI between 40–{form.rsiOverbought} (not overbought)</li>
                <li>MACD line crosses above signal</li>
              </ul>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1">📉 Sell Signal</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>EMA{form.emaFast} crosses below EMA{form.emaSlow}</li>
                <li>RSI between {form.rsiOversold}–60 (not oversold)</li>
                <li>MACD line crosses below signal</li>
              </ul>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1">🛡️ Risk Management</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Stop Loss: {form.stopLoss}% per trade</li>
                <li>Take Profit: {form.takeProfit}% per trade</li>
                <li>Risk {form.riskPerTrade}% of capital per trade</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* General */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Settings size={14} /> General</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <Field label="Trading Pair">
              <Select value={form.symbol ?? "BTC"} onValueChange={set("symbol")}>
                <SelectTrigger className="bg-muted border-border text-xs h-8" data-testid="select-symbol">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAIRS.map(p => (
                    <SelectItem key={p.symbol} value={p.symbol} className="text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Bot Name">
              <Input value={form.name ?? ""} onChange={e => set("name")(e.target.value)}
                className="bg-muted border-border text-foreground text-xs h-8" data-testid="input-name" />
            </Field>
            <Field label="Initial Capital ($)">
              <NumInput value={form.initialCapital ?? 10000} onChange={set("initialCapital")} min={100} step={100} />
            </Field>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-medium">Demo Mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Simulated trading only</p>
              </div>
              <Switch checked={form.demoMode ?? true} onCheckedChange={set("demoMode")} data-testid="switch-demo" />
            </div>
          </CardContent>
        </Card>

        {/* EMA Indicators */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span style={{color:"hsl(271 91% 65%)"}}>〜</span> EMA Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <Field label="Fast EMA Period" hint="Short-term trend (default: 9)">
              <NumInput value={form.emaFast ?? 9} onChange={set("emaFast")} min={3} max={50} />
            </Field>
            <Field label="Slow EMA Period" hint="Long-term trend (default: 21)">
              <NumInput value={form.emaSlow ?? 21} onChange={set("emaSlow")} min={5} max={200} />
            </Field>
            <Separator className="bg-border" />
            <Field label="RSI Period" hint="Relative strength (default: 14)">
              <NumInput value={form.rsiPeriod ?? 14} onChange={set("rsiPeriod")} min={2} max={50} />
            </Field>
            <Field label="RSI Overbought" hint="Sell threshold">
              <NumInput value={form.rsiOverbought ?? 70} onChange={set("rsiOverbought")} min={50} max={95} step={1} />
            </Field>
            <Field label="RSI Oversold" hint="Buy threshold">
              <NumInput value={form.rsiOversold ?? 30} onChange={set("rsiOversold")} min={5} max={50} step={1} />
            </Field>
          </CardContent>
        </Card>

        {/* MACD + Risk */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2"><Shield size={14} /> MACD & Risk</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <Field label="MACD Fast" hint="Default: 12">
              <NumInput value={form.macdFast ?? 12} onChange={set("macdFast")} min={2} max={50} />
            </Field>
            <Field label="MACD Slow" hint="Default: 26">
              <NumInput value={form.macdSlow ?? 26} onChange={set("macdSlow")} min={5} max={100} />
            </Field>
            <Field label="MACD Signal" hint="Default: 9">
              <NumInput value={form.macdSignal ?? 9} onChange={set("macdSignal")} min={2} max={50} />
            </Field>
            <Separator className="bg-border" />
            <Field label="Risk per Trade (%)" hint="% of capital per position">
              <NumInput value={form.riskPerTrade ?? 2} onChange={set("riskPerTrade")} min={0.1} max={25} step={0.1} />
            </Field>
            <Field label="Stop Loss (%)" hint="Max loss per trade">
              <NumInput value={form.stopLoss ?? 3} onChange={set("stopLoss")} min={0.5} max={20} step={0.5} />
            </Field>
            <Field label="Take Profit (%)" hint="Target gain per trade">
              <NumInput value={form.takeProfit ?? 6} onChange={set("takeProfit")} min={0.5} max={50} step={0.5} />
            </Field>
          </CardContent>
        </Card>
      </div>

      {/* Strategy notes */}
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3 text-foreground">Strategy Notes</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground mb-1">Signal Confirmation (3-factor)</p>
              <p>This strategy requires all three signals to align. Either a crossover + MACD agreement is enough for entry, but RSI must confirm. This reduces false signals significantly vs. single-indicator strategies.</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Risk-Reward</p>
              <p>Current R:R = <strong className="text-foreground">{(form.takeProfit ?? 6) / (form.stopLoss ?? 3)}:1</strong>. A good setup targets 2:1 or better. Adjust Take Profit and Stop Loss to tune. Higher R:R means fewer but larger wins.</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">EMA Crossover Guide</p>
              <p>EMA 9/21 is fast-reacting (good for volatile crypto). EMA 20/50 is slower and more reliable in trending markets. EMA 50/200 is the "golden cross" — rare but powerful signals.</p>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Backtesting</p>
              <p>Click Backtest to re-simulate 90 days of historical data with your new parameters. The engine replays every candle and executes trades exactly as the live bot would.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
