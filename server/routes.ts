import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage, db } from "./storage";
import { runDemoSimulation, computeStats, fetchHistoricalData } from "./engine";
import { startLiveTrader, stopLiveTrader, traderEvents, isLiveTraderRunning, getOpenPositionId } from "./livetrader";
import { getEngine, initAllEngines, rankCoins, getBestCoin, TOP_COINS } from "./orderflow";
import { trades, portfolioSnapshots, priceCandles } from "@shared/schema";

// Boot all 20 coin scanners simultaneously
initAllEngines();
let ofiEngine = getEngine("BTCUSDT");

export function registerRoutes(httpServer: Server, app: Express) {

  // ── WebSocket Server for real-time streaming ──────────────────────────────
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocket>();

  wss.on("connection", (ws) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    // Send initial state
    const summary = ofiEngine.getMarketSummary();
    if (summary) ws.send(JSON.stringify({ type: "market_summary", data: summary }));
  });

  // Broadcast OFI updates to all WS clients
  ofiEngine.on("ofi", (snap) => {
    const msg = JSON.stringify({ type: "ofi", data: snap });
    clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
  });

  ofiEngine.on("latency", (reading) => {
    const msg = JSON.stringify({ type: "latency", data: reading });
    clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
  });

  // Broadcast live trader events
  const broadcast = (type: string, data: any) => {
    const msg = JSON.stringify({ type, data });
    clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
  };
  traderEvents.on("trade_opened",   d => broadcast("trade_opened", d));
  traderEvents.on("trade_closed",   d => broadcast("trade_closed", d));
  traderEvents.on("position_update",d => broadcast("position_update", d));
  traderEvents.on("started",        () => broadcast("bot_started", {}));
  traderEvents.on("stopped",        () => broadcast("bot_stopped", {}));

  // ── Bot Config ────────────────────────────────────────────────────────────
  app.get("/api/config", (_req, res) => {
    try { res.json(storage.getBotConfig()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/config", (req, res) => {
    try {
      const updated = storage.upsertBotConfig(req.body);
      // Re-init OFI engine if symbol changed
      const sym = (req.body.symbol ?? "BTC").toUpperCase() + "USDT";
      if (sym !== ofiEngine.symbol) {
        ofiEngine.disconnect();
        ofiEngine = getEngine(sym);
        ofiEngine.on("ofi", (snap) => {
          const msg = JSON.stringify({ type: "ofi", data: snap });
          clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
        });
      }
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Bot Control ───────────────────────────────────────────────────────────
  app.post("/api/bot/start", async (req, res) => {
    try {
      const config = storage.getBotConfig()!;
      if (config.isRunning) return res.json({ status: "already_running" });
      const { real = false } = req.body ?? {};
      const startTime = config.competitionStartTime ?? new Date().toISOString();
      storage.upsertBotConfig({ isRunning: true, demoMode: !real, competitionStartTime: startTime });
      res.json({ status: "started", demoMode: !real, competitionStartTime: startTime, real });
      startLiveTrader();
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/competition/reset", (_req, res) => {
    try {
      storage.upsertBotConfig({ competitionStartTime: undefined as any, isRunning: false });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/bot/stop", (_req, res) => {
    try {
      storage.upsertBotConfig({ isRunning: false });
      stopLiveTrader();
      res.json({ status: "stopped" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Simulation ────────────────────────────────────────────────────────────
  app.post("/api/simulate", async (req, res) => {
    try {
      // Use scanner's best coin if no symbol specified
      let { symbol } = req.body;
      if (!symbol || symbol === "BTC") {
        const best = getBestCoin();
        if (best) symbol = best.displayName; // e.g. "SOL", "ETH"
      }
      symbol = symbol || "BTC";
      // Update config to reflect the chosen symbol
      storage.upsertBotConfig({ symbol });
      const result = await runDemoSimulation(symbol);
      res.json({ success: true, symbol, ...result });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get("/api/stats", (_req, res) => {
    try { res.json(computeStats()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Trades ────────────────────────────────────────────────────────────────
  app.get("/api/trades", (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      res.json(storage.getTrades(limit));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/trades/open", (_req, res) => {
    try {
      const trade = storage.getOpenTrade() ?? null;
      if (!trade) return res.json(null);
      // Enrich with live P&L
      const price = trade.symbol ? getEngine(trade.symbol + "USDT").getLatestOFI()?.midPrice ?? null : null;
      const unrealizedPnl = price
        ? (trade.side === "buy" ? price - trade.entryPrice : trade.entryPrice - price) * trade.quantity
        : null;
      res.json({ ...trade, currentPrice: price, unrealizedPnl });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Portfolio ─────────────────────────────────────────────────────────────
  app.get("/api/portfolio/snapshots", (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 300;
      res.json(storage.getPortfolioSnapshots(limit));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/portfolio/latest", (_req, res) => {
    try {
      const config = storage.getBotConfig()!;
      const snap = storage.getLatestSnapshot();
      res.json(snap ?? { totalValue: config.initialCapital, cashBalance: config.initialCapital, cryptoValue: 0, realizedPnl: 0, unrealizedPnl: 0, drawdown: 0 });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Candles ───────────────────────────────────────────────────────────────
  app.get("/api/candles/:symbol", (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 200;
      res.json(storage.getCandles(req.params.symbol.toUpperCase(), limit));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Live Price ────────────────────────────────────────────────────────────
  app.get("/api/price/:symbol", async (req, res) => {
    try {
      // First try OFI engine's live mid price
      const summary = ofiEngine.getMarketSummary();
      if (summary && summary.midPrice > 0) {
        return res.json({ symbol: req.params.symbol.toUpperCase(), price: summary.midPrice, change24h: 0, source: "orderbook" });
      }
      const coinMap: Record<string, string> = {
        BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
        ADA: "cardano", DOGE: "dogecoin",
      };
      const coinId = coinMap[req.params.symbol.toUpperCase()] || "bitcoin";
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`);
      if (!r.ok) throw new Error("Price fetch failed");
      const data = await r.json();
      const info = data[coinId];
      res.json({ symbol: req.params.symbol.toUpperCase(), price: info?.usd ?? 0, change24h: info?.usd_24h_change ?? 0, source: "coingecko" });
    } catch {
      const candles = storage.getCandles(req.params.symbol.toUpperCase(), 200);
      const last = candles[candles.length - 1];
      res.json({ symbol: req.params.symbol.toUpperCase(), price: last?.close ?? 0, change24h: 0, source: "cache" });
    }
  });

  // ── Order Flow & Market Microstructure ────────────────────────────────────
  app.get("/api/orderflow/summary", (_req, res) => {
    try {
      const summary = ofiEngine.getMarketSummary();
      res.json(summary ?? { error: "No data yet" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/orderflow/ofi", (req, res) => {
    try {
      const n = parseInt(req.query.n as string) || 100;
      res.json(ofiEngine.getOFIHistory(n));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/orderflow/book", (_req, res) => {
    try {
      const book = ofiEngine.getOrderBook();
      res.json({
        bids: book.bids.slice(0, 15),
        asks: book.asks.slice(0, 15),
        timestamp: book.timestamp,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/orderflow/execution-window", (req, res) => {
    try {
      const side = (req.query.side as string) || "buy";
      const window = ofiEngine.getExecutionWindow(side as "buy" | "sell");
      res.json(window);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Latency ───────────────────────────────────────────────────────────────
  app.get("/api/latency", (req, res) => {
    try {
      const n = parseInt(req.query.n as string) || 60;
      const history = ofiEngine.getLatencyHistory(n);
      const current = ofiEngine.getCurrentLatency();
      const avg = history.length > 0 ? history.reduce((s, l) => s + l.roundTripMs, 0) / history.length : 0;
      const p99 = history.length > 0 ? [...history].sort((a, b) => a.roundTripMs - b.roundTripMs)[Math.floor(history.length * 0.99)]?.roundTripMs ?? 0 : 0;
      const spikes = history.filter(l => l.quality === "red").length;
      res.json({
        current, history,
        avg, p99,
        avgMs: avg, p99Ms: p99, latencySpikes: spikes,
        currentQuality: current?.quality ?? "yellow",
        isConnected: ofiEngine.isConnected,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Multi-Coin Scanner ────────────────────────────────────────────────
  app.get("/api/scanner/rankings", (_req, res) => {
    try {
      res.json(rankCoins());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/scanner/best", (_req, res) => {
    try {
      const best = getBestCoin();
      res.json(best ?? { error: "No data yet" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/scanner/coins", (_req, res) => {
    res.json({ coins: TOP_COINS.map(s => s.replace("USDT", "")), count: TOP_COINS.length });
  });

  // ── Infrastructure Recommendations ────────────────────────────────────────
  app.get("/api/infrastructure", (_req, res) => {
    res.json({
      recommendation: "Deploy on AWS Osaka (ap-northeast-3) for 10-14ms RTT to Binance. Use c7i.2xlarge with Enhanced Networking. Osaka edges out Tokyo in head-to-head tests across 4,000 limit orders.",
      regions: [
        { name: "AWS Osaka", region: "ap-northeast-3", estimatedLatencyMs: 12, rank: 1, notes: "Best for Binance — edges out Tokyo in 4k order A/B test" },
        { name: "AWS Tokyo", region: "ap-northeast-1", estimatedLatencyMs: 16, rank: 2, notes: "Solid fallback, well-peered with Binance matching engine" },
        { name: "AWS Singapore", region: "ap-southeast-1", estimatedLatencyMs: 28, rank: 3, notes: "Good for APAC liquidity, slightly higher RTT" },
        { name: "AWS Frankfurt", region: "eu-central-1", estimatedLatencyMs: 85, rank: 4, notes: "For European session trading windows only" },
      ],
      instanceRecommendation: "c7i.2xlarge or c7g.2xlarge (ENA enabled)",
      estimatedCostPerHour: "£0.40-0.95",
      tradingWindows: [
        { window: "10:00-12:00 UTC", quality: "Optimal", notes: "Peak Asian/European overlap — tight spreads, deep books, reliable momentum" },
        { window: "15:00-17:00 UTC", quality: "Excellent", notes: "US afternoon session — sustained directional moves, low jitter" },
        { window: "04:00-06:00 UTC", quality: "Good", notes: "Early Asian session — algorithmic momentum patterns highly reliable" },
      ],
      avoidWindows: [
        { window: "08:45-09:15 UTC", reason: "Binance maintenance window — latency spikes 3-5x, books reset" },
        { window: "13:25-13:35 UTC", reason: "US equity open — crypto volatility surge, spreads widen 2-4x" },
        { window: "21:00-21:30 UTC", reason: "Asian close — thin liquidity, large slippage, avoid large positions" },
      ],
      competitionAdvice: [
        "A 5090 making bad decisions faster still loses. OFI tells you WHEN the book tips before price moves.",
        "Pause trading during red-latency windows — a 120ms execution into a thin book costs more than the missed trade.",
        "Momentum ignition events are your biggest edge. The model detects the algo pump 2-5 seconds before completion.",
        "Pre-sign all orders before signal fires. Eliminate auth latency from the critical path.",
        "Use market orders for exits — limit orders risk partial fills during ignition bursts.",
        "Binance SBE binary encoding reduces parsing overhead by 40% vs JSON WebSocket stream.",
        "Cluster placement group on AWS gives sub-1ms intra-node latency if running distributed workers.",
        "Set max order age to 5s — stale fills in a moved market are worse than missed entries.",
      ],
    });
  });

  // ── Competition Mode ──────────────────────────────────────────────────────
  app.get("/api/competition/status", (_req, res) => {
    try {
      const config = storage.getBotConfig()!;
      const stats = computeStats();
      const snap = storage.getLatestSnapshot();
      const latency = ofiEngine.getCurrentLatency();
      const ofi = ofiEngine.getLatestOFI();

      res.json({
        // Original fields
        botName: config.name,
        initialCapital: config.initialCapital,
        currentValue: snap?.totalValue ?? config.initialCapital,
        pnlPercent: stats.totalReturn,
        winRate: stats.winRate,
        totalTrades: stats.totalTrades,
        sharpe: stats.sharpe,
        maxDrawdown: stats.maxDrawdown,
        latencyMs: latency?.roundTripMs ?? null,
        latencyQuality: latency?.quality ?? "yellow",
        ofiScore: ofi?.ofiSmooth ?? 0,
        executionQuality: ofi?.executionQuality ?? "good",
        momentumActive: ofi?.momentumIgnition ?? false,
        isRunning: config.isRunning,
        demoMode: config.demoMode,
        // Competition-specific fields
        sessionStarted: !!(config.competitionStartTime),
        startTime: config.competitionStartTime ? new Date(config.competitionStartTime).getTime() : null,
        currentTime: Date.now(),
        elapsed: config.competitionStartTime ? Date.now() - new Date(config.competitionStartTime).getTime() : 0,
        remaining: config.competitionStartTime
          ? Math.max(0, 24 * 3600 * 1000 - (Date.now() - new Date(config.competitionStartTime).getTime()))
          : 24 * 3600 * 1000,
        portfolioValue: snap?.totalValue ?? config.initialCapital,
        startingCapital: config.initialCapital,
        pnl: stats.totalPnl,
        pnlPct: stats.totalReturn,
        winProbability: Math.min(95, Math.max(5, 50 + stats.totalReturn * 5 + (stats.winRate - 50) * 0.5)),
        tradesExecuted: stats.totalTrades,
        currentStreak: 0,
        edgeScore: Math.min(100, Math.round(50 + (ofi?.ofiSmooth ?? 0) * 30 + (stats.winRate - 50) * 0.5 + (latency?.quality === "green" ? 10 : latency?.quality === "red" ? -15 : 0))),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ── Reset ─────────────────────────────────────────────────────────────────
  app.post("/api/reset", (_req, res) => {
    try {
      db.delete(trades).run();
      db.delete(portfolioSnapshots).run();
      db.delete(priceCandles).run();
      storage.upsertBotConfig({ isRunning: false });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
