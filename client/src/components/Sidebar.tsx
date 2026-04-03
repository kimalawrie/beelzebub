import { Link, useLocation } from "wouter";
import { Scan, Activity, TrendingUp, Wallet, Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { BotConfig } from "@shared/schema";

const navItems = [
  { href: "/", icon: Activity, label: "Dashboard" },
  { href: "/trades", icon: TrendingUp, label: "Trades" },
  { href: "/strategy", icon: Scan, label: "Scanner" },
  { href: "/portfolio", icon: Wallet, label: "Portfolio" },
  { href: "/competition", icon: Trophy, label: "Competition", highlight: true },
];

export default function Sidebar() {
  const [location] = useLocation();
  const { data: config } = useQuery<BotConfig>({
    queryKey: ["/api/config"],
    refetchInterval: 5000,
  });

  const isRunning = config?.isRunning ?? false;

  return (
    <aside className="w-56 flex-shrink-0 bg-card border-r border-border flex flex-col" data-testid="sidebar">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <svg aria-label="Beelzebub" viewBox="0 0 32 32" className="w-7 h-7 flex-shrink-0" fill="none">
            <rect width="32" height="32" rx="6" fill="hsl(var(--primary) / 0.12)" />
            <polyline points="4,22 10,14 16,18 22,8 28,12" fill="none" stroke="hsl(var(--primary))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="28" cy="12" r="2.5" fill="hsl(var(--primary))" />
          </svg>
          <div>
            <div className="text-sm font-bold text-foreground leading-tight tracking-wide">Beelzebub</div>
            <div className="text-xs text-muted-foreground font-mono">v2.0 · Demo</div>
          </div>
        </div>
      </div>

      {/* Status indicator */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isRunning ? "bg-green-400 live-dot" : "bg-muted-foreground"}`} />
          <span className={isRunning ? "text-green-400 font-medium" : "text-muted-foreground"}>
            {isRunning ? "Bot Running" : "Bot Stopped"}
          </span>
        </div>
        {config?.demoMode && (
          <div className="mt-1 flex items-center gap-1.5 text-xs text-yellow-400/80">
            <span>◈</span>
            <span>Demo Mode</span>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5" role="navigation">
        {navItems.map(({ href, icon: Icon, label, highlight }) => {
          const active = location === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? "bg-primary/10 text-primary border border-primary/20"
                  : highlight
                  ? "text-yellow-400/80 hover:text-yellow-400 hover:bg-yellow-400/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              data-testid={`nav-${label.toLowerCase()}`}
            >
              <Icon size={16} />
              {label}
              {highlight && !active && (
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-400 font-bold uppercase tracking-wider">
                  NEW
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom info */}
      <div className="px-4 py-3 border-t border-border space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Symbol</span>
          <span className="font-mono font-medium text-foreground">{config?.symbol ?? "BTC"}/USDT</span>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Strategy</span>
          <span className="font-mono text-foreground text-[10px]">EMA·RSI·MACD+OFI</span>
        </div>
      </div>
    </aside>
  );
}
