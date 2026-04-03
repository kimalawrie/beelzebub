/**
 * Order Flow Intelligence Engine
 * 
 * Real-time analysis of Binance WebSocket streams:
 * - Order Flow Imbalance (OFI): measures buy vs sell pressure at each price level
 * - Momentum Ignition Detection: spots algorithmic pump signals before full execution
 * - Trade Aggression Score: how aggressively market orders are hitting the book
 * - Volume Velocity: rate of change of volume hitting bid/ask
 * - Spread & Slippage Estimator: predicts execution cost before placing order
 * 
 * The key insight your brother-in-law misses with raw compute:
 * A 5090 making bad decisions faster still loses. The edge is KNOWING
 * when NOT to trade (high latency windows, thin books, momentum exhaustion)
 * and knowing EXACTLY which millisecond the book tips in your favour.
 */

import WebSocket from "ws";
import { EventEmitter } from "events";

// ── Types ────────────────────────────────────────────────────────────────────

export interface OrderBookLevel {
  price: number;
  qty: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];   // sorted desc
  asks: OrderBookLevel[];   // sorted asc
  lastUpdateId: number;
  timestamp: number;
}

export interface OFISnapshot {
  timestamp: number;
  ofi: number;              // raw order flow imbalance (-1 to +1 normalized)
  ofiSmooth: number;        // EMA-smoothed OFI
  bidDepth: number;         // total bid liquidity (USD) top 10 levels
  askDepth: number;         // total ask liquidity (USD) top 10 levels
  depthRatio: number;       // bid / (bid + ask) — >0.5 = buy pressure
  midPrice: number;
  spread: number;           // absolute spread in USD
  spreadBps: number;        // spread in basis points
  aggressionScore: number;  // 0-100: how hard market orders are hitting
  momentumIgnition: boolean;
  momentumDirection: "up" | "down" | null;
  executionQuality: "excellent" | "good" | "poor" | "avoid";
}

export interface TradeStream {
  price: number;
  qty: number;
  isBuyerMaker: boolean;    // true = sell aggressor hit the bid
  timestamp: number;
}

export interface LatencyReading {
  timestamp: number;
  roundTripMs: number;
  serverTimeOffsetMs: number;
  wsLatencyMs: number;
  quality: "green" | "yellow" | "red";
}

export interface ExecutionWindow {
  shouldTrade: boolean;
  reason: string;
  confidence: number;       // 0-100
  expectedSlippageBps: number;
  optimalSide: "buy" | "sell" | null;
  urgency: "immediate" | "wait" | "abort";
}

// ── Order Flow Engine ─────────────────────────────────────────────────────────

export class OrderFlowEngine extends EventEmitter {
  private ws: WebSocket | null = null;
  private tradeWs: WebSocket | null = null;
  private book: OrderBook = { bids: [], asks: [], lastUpdateId: 0, timestamp: Date.now() };
  private prevBook: OrderBook | null = null;
  private recentTrades: TradeStream[] = [];
  private ofiHistory: OFISnapshot[] = [];
  private latencyHistory: LatencyReading[] = [];
  public symbol: string;
  private pingInterval: NodeJS.Timeout | null = null;
  private wsConnectTime: number = 0;
  private lastPingTime: number = 0;
  private latestOFI: OFISnapshot | null = null;
  private ofiEma: number = 0;
  private aggressionEma: number = 50;
  private volumeWindow: { buy: number; sell: number; ts: number }[] = [];
  public isConnected: boolean = false;
  public simulatedMode: boolean = true;
  private simInterval: NodeJS.Timeout | null = null;

  constructor(symbol: string = "BTCUSDT") {
    super();
    this.symbol = symbol;
  }

  // ── Connect to Binance WebSocket ──────────────────────────────────────────

  connect() {
    // In demo/paper mode, simulate live order book data
    if (this.simulatedMode) {
      this.startSimulation();
      return;
    }
    this.connectLive();
  }

  private connectLive() {
    const base = "wss://stream.binance.com:9443/stream?streams=";
    const streams = [
      `${this.symbol.toLowerCase()}@depth20@100ms`,
      `${this.symbol.toLowerCase()}@aggTrade`,
    ].join("/");

    try {
      this.ws = new WebSocket(`${base}${streams}`);
      this.wsConnectTime = Date.now();

      this.ws.on("open", () => {
        this.isConnected = true;
        this.emit("connected");
        this.startPing();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.stream?.includes("depth")) this.handleDepthUpdate(msg.data);
          if (msg.stream?.includes("aggTrade")) this.handleTrade(msg.data);
        } catch {}
      });

      this.ws.on("error", () => {
        this.isConnected = false;
        this.emit("error");
        setTimeout(() => this.connectLive(), 3000);
      });

      this.ws.on("close", () => {
        this.isConnected = false;
        setTimeout(() => this.connectLive(), 2000);
      });
    } catch {
      this.startSimulation();
    }
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.lastPingTime = Date.now();
        this.ws.ping();
        this.ws.once("pong", () => {
          const rtt = Date.now() - this.lastPingTime;
          this.recordLatency(rtt);
        });
      }
    }, 5000);
  }

  // ── Simulated Order Book (realistic crypto microstructure) ────────────────

  private startSimulation() {
    this.isConnected = true;
    this.simulatedMode = true;
    this.emit("connected");

    // Seed realistic BTC order book around current approximate price
    const seedPrices: Record<string, number> = {
      BTCUSDT: 67500, ETHUSDT: 3450, SOLUSDT: 185, BNBUSDT: 590,
    };
    let mid = seedPrices[this.symbol] ?? 67500;
    let trend = 0;
    let trendStrength = 0;
    let volatility = mid * 0.0008;

    this.simInterval = setInterval(() => {
      // Simulate realistic market microstructure with momentum bursts
      const momentumChance = Math.random();
      if (momentumChance > 0.94) {
        // Momentum ignition event
        trendStrength = Math.random() * 3 + 1;
        trend = Math.random() > 0.5 ? 1 : -1;
        setTimeout(() => { trendStrength = 0; trend = 0; }, 8000 + Math.random() * 12000);
      }

      // Price movement
      const drift = trend * trendStrength * volatility * 0.3;
      const noise = (Math.random() - 0.5) * volatility;
      mid = mid + drift + noise;
      mid = Math.max(mid * 0.97, Math.min(mid * 1.03, mid)); // clip

      // Simulate spread widening during volatility
      const spreadFactor = 1 + Math.abs(trend) * trendStrength * 0.5;
      const spread = (mid * 0.0001) * spreadFactor;

      // Build simulated order book with realistic depth profile
      const bids: OrderBookLevel[] = [];
      const asks: OrderBookLevel[] = [];
      const levels = 20;

      // Imbalance simulation: trend direction loads one side
      const imbalanceFactor = 1 + trend * trendStrength * 0.3;

      for (let i = 0; i < levels; i++) {
        const priceDelta = (i + 0.5) * spread * (1 + i * 0.15);
        const baseQty = (Math.random() * 2 + 0.1) * (1 - i * 0.03);
        const bidQty = baseQty * (i === 0 ? imbalanceFactor : (0.8 + Math.random() * 0.4));
        const askQty = baseQty * (i === 0 ? (2 - imbalanceFactor) : (0.8 + Math.random() * 0.4));
        bids.push({ price: mid - spread / 2 - priceDelta, qty: Math.max(0.001, bidQty) });
        asks.push({ price: mid + spread / 2 + priceDelta, qty: Math.max(0.001, askQty) });
      }

      this.prevBook = { ...this.book };
      this.book = { bids, asks, lastUpdateId: Date.now(), timestamp: Date.now() };
      this.analyzeOrderFlow();

      // Simulate trades
      const tradeCount = Math.floor(Math.random() * 3) + 1;
      for (let t = 0; t < tradeCount; t++) {
        const isBuy = Math.random() > (0.5 - trend * trendStrength * 0.1);
        const tradeSize = Math.random() * 0.5 + 0.01;
        this.handleTrade({
          p: (mid + (Math.random() - 0.5) * spread).toFixed(2),
          q: tradeSize.toFixed(4),
          m: !isBuy, // m=true means buyer is maker (sell aggressor)
          T: Date.now(),
        });
      }

      // Simulate latency
      const baseLatency = 12 + Math.random() * 8;
      const spikeFactor = Math.random() > 0.95 ? Math.random() * 80 : 0;
      this.recordLatency(baseLatency + spikeFactor);

    }, 200); // 200ms tick = 5fps order book updates
  }

  // ── Depth Update Handler ──────────────────────────────────────────────────

  private handleDepthUpdate(data: any) {
    if (!data?.bids || !data?.asks) return;
    this.prevBook = { ...this.book };
    this.book = {
      bids: data.bids.map(([p, q]: string[]) => ({ price: +p, qty: +q })),
      asks: data.asks.map(([p, q]: string[]) => ({ price: +p, qty: +q })),
      lastUpdateId: data.lastUpdateId ?? 0,
      timestamp: Date.now(),
    };
    this.analyzeOrderFlow();
  }

  private handleTrade(data: any) {
    const trade: TradeStream = {
      price: parseFloat(data.p),
      qty: parseFloat(data.q),
      isBuyerMaker: data.m, // true = SELL aggressor (buyer is maker)
      timestamp: data.T ?? Date.now(),
    };
    this.recentTrades.push(trade);

    // Rolling 30s window
    const cutoff = Date.now() - 30000;
    this.recentTrades = this.recentTrades.filter(t => t.timestamp > cutoff);

    // Volume velocity tracking
    this.volumeWindow.push({
      buy: trade.isBuyerMaker ? 0 : trade.qty * trade.price,
      sell: trade.isBuyerMaker ? trade.qty * trade.price : 0,
      ts: trade.timestamp,
    });
    const cutoff5s = Date.now() - 5000;
    this.volumeWindow = this.volumeWindow.filter(v => v.ts > cutoff5s);
  }

  // ── Core OFI Analysis ─────────────────────────────────────────────────────

  private analyzeOrderFlow() {
    if (!this.book.bids.length || !this.book.asks.length) return;

    const bids = this.book.bids.slice(0, 10);
    const asks = this.book.asks.slice(0, 10);
    const midPrice = (bids[0].price + asks[0].price) / 2;
    const spread = asks[0].price - bids[0].price;
    const spreadBps = (spread / midPrice) * 10000;

    // Depth-weighted liquidity
    const bidDepth = bids.reduce((s, l) => s + l.price * l.qty, 0);
    const askDepth = asks.reduce((s, l) => s + l.price * l.qty, 0);
    const totalDepth = bidDepth + askDepth;
    const depthRatio = totalDepth > 0 ? bidDepth / totalDepth : 0.5;

    // Order Flow Imbalance: change in best bid/ask quantities
    let ofi = 0;
    if (this.prevBook?.bids?.length && this.prevBook?.asks?.length) {
      const prevBestBid = this.prevBook.bids[0];
      const prevBestAsk = this.prevBook.asks[0];
      const currBestBid = bids[0];
      const currBestAsk = asks[0];

      // If price same: quantity change, if price different: full quantity
      const bidChange = currBestBid.price >= prevBestBid.price
        ? currBestBid.qty - (currBestBid.price === prevBestBid.price ? prevBestBid.qty : 0)
        : -prevBestBid.qty;
      const askChange = currBestAsk.price <= prevBestAsk.price
        ? currBestAsk.qty - (currBestAsk.price === prevBestAsk.price ? prevBestAsk.qty : 0)
        : -prevBestAsk.qty;

      const rawOfi = bidChange - askChange;
      const normFactor = Math.max(currBestBid.qty + currBestAsk.qty, 0.001);
      ofi = Math.max(-1, Math.min(1, rawOfi / normFactor));
    }

    // EMA smoothing (α = 0.3)
    this.ofiEma = 0.3 * ofi + 0.7 * this.ofiEma;

    // Trade Aggression Score
    let buyVol = 0, sellVol = 0;
    this.recentTrades.forEach(t => {
      if (t.isBuyerMaker) sellVol += t.qty * t.price;
      else buyVol += t.qty * t.price;
    });
    const totalVol = buyVol + sellVol;
    const rawAggression = totalVol > 0 ? (buyVol / totalVol) * 100 : 50;
    this.aggressionEma = 0.2 * rawAggression + 0.8 * this.aggressionEma;

    // Momentum Ignition Detection
    // Criteria: OFI spike > 0.6, depth ratio extreme, aggression > 70 or < 30
    const ofiSpike = Math.abs(this.ofiEma) > 0.45;
    const aggressionExtreme = this.aggressionEma > 68 || this.aggressionEma < 32;
    const depthImbalance = depthRatio > 0.65 || depthRatio < 0.35;
    const momentumIgnition = ofiSpike && aggressionExtreme && depthImbalance;
    const momentumDirection: "up" | "down" | null = momentumIgnition
      ? (this.ofiEma > 0 ? "up" : "down")
      : null;

    // Volume velocity (5s window)
    const recentBuyVol = this.volumeWindow.reduce((s, v) => s + v.buy, 0);
    const recentSellVol = this.volumeWindow.reduce((s, v) => s + v.sell, 0);

    // Execution Quality Assessment
    let executionQuality: OFISnapshot["executionQuality"] = "good";
    if (spreadBps < 1.5 && this.aggressionEma > 35 && this.aggressionEma < 65) {
      executionQuality = "excellent";
    } else if (spreadBps > 5 || Math.abs(this.ofiEma) > 0.7) {
      executionQuality = "poor";
    } else if (spreadBps > 10 || momentumIgnition) {
      executionQuality = "avoid";
    }

    const snap: OFISnapshot = {
      timestamp: Date.now(),
      ofi, ofiSmooth: this.ofiEma,
      bidDepth, askDepth, depthRatio, midPrice,
      spread, spreadBps,
      aggressionScore: this.aggressionEma,
      momentumIgnition, momentumDirection,
      executionQuality,
    };

    this.latestOFI = snap;
    this.ofiHistory.push(snap);
    if (this.ofiHistory.length > 500) this.ofiHistory = this.ofiHistory.slice(-500);

    this.emit("ofi", snap);
  }

  // ── Smart Execution Advisor ───────────────────────────────────────────────

  getExecutionWindow(side: "buy" | "sell"): ExecutionWindow {
    if (!this.latestOFI) {
      return { shouldTrade: false, reason: "No market data yet", confidence: 0, expectedSlippageBps: 999, optimalSide: null, urgency: "wait" };
    }

    const o = this.latestOFI;
    const latestLatency = this.latencyHistory[this.latencyHistory.length - 1];

    // Abort conditions
    if (latestLatency?.quality === "red") {
      return { shouldTrade: false, reason: "High latency detected — skip this window", confidence: 10, expectedSlippageBps: o.spreadBps * 3, optimalSide: null, urgency: "abort" };
    }
    if (o.executionQuality === "avoid") {
      return { shouldTrade: false, reason: "Book too thin / momentum spike — wait for settle", confidence: 20, expectedSlippageBps: o.spreadBps * 2, optimalSide: null, urgency: "wait" };
    }

    // Calculate alignment score
    let confidence = 50;
    let expectedSlippageBps = o.spreadBps;

    // OFI alignment
    if (side === "buy" && o.ofiSmooth > 0.2) confidence += 20;
    if (side === "buy" && o.ofiSmooth > 0.4) confidence += 15;
    if (side === "sell" && o.ofiSmooth < -0.2) confidence += 20;
    if (side === "sell" && o.ofiSmooth < -0.4) confidence += 15;

    // Depth ratio alignment
    if (side === "buy" && o.depthRatio > 0.55) confidence += 10;
    if (side === "sell" && o.depthRatio < 0.45) confidence += 10;

    // Aggression alignment
    if (side === "buy" && o.aggressionScore > 55) confidence += 10;
    if (side === "sell" && o.aggressionScore < 45) confidence += 10;

    // Momentum ignition bonus — but only if we're riding it, not fighting it
    if (o.momentumIgnition && o.momentumDirection === side.replace("buy","up").replace("sell","down")) {
      confidence += 15;
    }

    // Penalize cross-OFI trades
    if (side === "buy" && o.ofiSmooth < -0.3) { confidence -= 25; expectedSlippageBps *= 2; }
    if (side === "sell" && o.ofiSmooth > 0.3) { confidence -= 25; expectedSlippageBps *= 2; }

    // Spread penalty
    if (o.spreadBps > 3) confidence -= 10;
    if (o.spreadBps > 6) confidence -= 20;

    // Latency bonus
    if (latestLatency?.quality === "green") confidence += 5;

    confidence = Math.max(0, Math.min(100, confidence));
    const shouldTrade = confidence > 55;

    const urgency: ExecutionWindow["urgency"] = o.momentumIgnition ? "immediate"
      : confidence > 75 ? "immediate"
      : shouldTrade ? "wait"
      : "abort";

    const optimalSide: "buy" | "sell" | null = o.ofiSmooth > 0.2 ? "buy"
      : o.ofiSmooth < -0.2 ? "sell"
      : null;

    const reason = !shouldTrade
      ? `OFI=${o.ofiSmooth.toFixed(2)} unfavourable for ${side}. Slippage est. ${expectedSlippageBps.toFixed(1)}bps`
      : `OFI=${o.ofiSmooth.toFixed(2)} aligned. Depth ratio ${(o.depthRatio*100).toFixed(0)}% bid. Spread ${o.spreadBps.toFixed(1)}bps`;

    return { shouldTrade, reason, confidence, expectedSlippageBps, optimalSide, urgency };
  }

  // ── Latency Tracking ──────────────────────────────────────────────────────

  recordLatency(rttMs: number) {
    const quality: LatencyReading["quality"] = rttMs < 25 ? "green" : rttMs < 80 ? "yellow" : "red";
    const reading: LatencyReading = {
      timestamp: Date.now(),
      roundTripMs: rttMs,
      serverTimeOffsetMs: 0,
      wsLatencyMs: rttMs / 2,
      quality,
    };
    this.latencyHistory.push(reading);
    if (this.latencyHistory.length > 200) this.latencyHistory = this.latencyHistory.slice(-200);
    this.emit("latency", reading);
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  getLatestOFI(): OFISnapshot | null { return this.latestOFI; }
  getOrderBook(): OrderBook { return this.book; }
  getOFIHistory(n = 100): OFISnapshot[] { return this.ofiHistory.slice(-n); }
  getLatencyHistory(n = 60): LatencyReading[] { return this.latencyHistory.slice(-n); }
  getCurrentLatency(): LatencyReading | null { return this.latencyHistory[this.latencyHistory.length - 1] ?? null; }

  getMarketSummary() {
    const o = this.latestOFI;
    const l = this.getCurrentLatency();
    if (!o) return null;
    return {
      midPrice: o.midPrice,
      spread: o.spread,
      spreadBps: o.spreadBps,
      ofi: o.ofiSmooth,
      depthRatio: o.depthRatio,
      bidDepth: o.bidDepth,
      askDepth: o.askDepth,
      aggressionScore: o.aggressionScore,
      momentumIgnition: o.momentumIgnition,
      momentumDirection: o.momentumDirection,
      executionQuality: o.executionQuality,
      latencyMs: l?.roundTripMs ?? null,
      latencyQuality: l?.quality ?? "yellow",
      isConnected: this.isConnected,
    };
  }

  disconnect() {
    if (this.simInterval) clearInterval(this.simInterval);
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.ws?.close();
    this.tradeWs?.close();
    this.isConnected = false;
  }
}

// Singleton per symbol
const engines = new Map<string, OrderFlowEngine>();

export function getEngine(symbol: string = "BTCUSDT"): OrderFlowEngine {
  if (!engines.has(symbol)) {
    const e = new OrderFlowEngine(symbol);
    e.connect();
    engines.set(symbol, e);
  }
  return engines.get(symbol)!;
}

// ── Multi-Coin Scanner ─────────────────────────────────────────────────────

export const TOP_COINS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "MATICUSDT",
  "LINKUSDT", "LTCUSDT", "UNIUSDT", "ATOMUSDT", "NEARUSDT",
  "APTUSDT", "OPUSDT", "ARBUSDT", "FILUSDT", "INJUSDT",
];

export interface CoinRanking {
  symbol: string;
  displayName: string;
  ofiScore: number;         // abs smoothed OFI
  ofiDirection: "buy" | "sell" | "neutral";
  spreadBps: number;
  aggressionScore: number;
  executionQuality: string;
  momentumIgnition: boolean;
  momentumDirection: "up" | "down" | null;
  midPrice: number;
  depthRatio: number;
  latencyMs: number | null;
  signalStrength: number;   // composite 0-100 score
  rank: number;
}

export function initAllEngines(): void {
  for (const sym of TOP_COINS) {
    getEngine(sym);
  }
}

export function rankCoins(): CoinRanking[] {
  const rankings: CoinRanking[] = [];

  for (const sym of TOP_COINS) {
    const engine = engines.get(sym);
    if (!engine) continue;
    const ofi = engine.getLatestOFI();
    const latency = engine.getCurrentLatency();
    if (!ofi) continue;

    // Composite signal strength:
    // - High |OFI| = strong directional pressure (40%)
    // - Tight spread = cheap execution (20%)
    // - Aggression extremity = conviction (20%)
    // - Momentum ignition = big alpha (20% bonus)
    const ofiComponent = Math.min(1, Math.abs(ofi.ofiSmooth) / 0.6) * 40;
    const spreadComponent = Math.max(0, (1 - ofi.spreadBps / 10)) * 20;
    const aggressionComponent = Math.abs(ofi.aggressionScore - 50) / 50 * 20;
    const momentumBonus = ofi.momentumIgnition ? 20 : 0;

    const signalStrength = Math.min(100, ofiComponent + spreadComponent + aggressionComponent + momentumBonus);

    const displayName = sym.replace("USDT", "");
    const ofiDirection: "buy" | "sell" | "neutral" = ofi.ofiSmooth > 0.15 ? "buy" : ofi.ofiSmooth < -0.15 ? "sell" : "neutral";

    rankings.push({
      symbol: sym,
      displayName,
      ofiScore: ofi.ofiSmooth,
      ofiDirection,
      spreadBps: ofi.spreadBps,
      aggressionScore: ofi.aggressionScore,
      executionQuality: ofi.executionQuality,
      momentumIgnition: ofi.momentumIgnition,
      momentumDirection: ofi.momentumDirection,
      midPrice: ofi.midPrice,
      depthRatio: ofi.depthRatio,
      latencyMs: latency?.roundTripMs ?? null,
      signalStrength,
      rank: 0,
    });
  }

  // Sort by signal strength descending
  rankings.sort((a, b) => b.signalStrength - a.signalStrength);
  rankings.forEach((r, i) => r.rank = i + 1);

  return rankings;
}

export function getBestCoin(): CoinRanking | null {
  const ranked = rankCoins();
  return ranked.length > 0 ? ranked[0] : null;
}
