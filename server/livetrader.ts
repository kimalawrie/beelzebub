/**
 * Beelzebub Live Paper Trading Loop
 *
 * Runs in real-time when the bot is started:
 * - Every 15s: scans all 20 coins, picks the best OFI signal
 * - Opens a simulated position at the current market price
 * - Monitors the position every 5s against live prices
 * - Closes on take-profit, stop-loss, or signal reversal
 * - Emits events so the frontend updates instantly
 */

import { EventEmitter } from "events";
import { storage } from "./storage";
import { getBestCoin, getEngine } from "./orderflow";
import type { InsertTrade, InsertPortfolioSnapshot } from "@shared/schema";

export const traderEvents = new EventEmitter();

// ── Config ───────────────────────────────────────────────────────────────────

const SCAN_INTERVAL_MS    = 15_000;   // look for new trades every 15s
const MONITOR_INTERVAL_MS = 5_000;    // check open position every 5s
const MIN_SIGNAL_STRENGTH = 35;       // minimum signal score to enter
const MIN_OFI_THRESHOLD   = 0.15;     // minimum |OFI| to enter

// ── State ─────────────────────────────────────────────────────────────────────

let scanTimer:    NodeJS.Timeout | null = null;
let monitorTimer: NodeJS.Timeout | null = null;
let isRunning = false;
let openPositionId: number | null = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLivePrice(symbol: string): number | null {
  const engine = getEngine(symbol + "USDT");
  const ofi = engine.getLatestOFI();
  return ofi?.midPrice ?? null;
}

function feeRate(): number { return 0.001; } // 0.1% taker fee

// ── Position Management ───────────────────────────────────────────────────────

function openPosition(symbol: string, side: "buy" | "sell", price: number, ofiScore: number, rsi: number | null) {
  const config = storage.getBotConfig()!;
  const snap = storage.getLatestSnapshot();
  const cash = snap?.cashBalance ?? config.initialCapital;

  // Risk 2% of portfolio per trade
  const riskAmount = cash * (config.riskPerTrade / 100);
  const quantity = riskAmount / price;
  const fees = quantity * price * feeRate();

  const trade: InsertTrade = {
    symbol,
    side,
    entryPrice: price,
    quantity,
    entryTime: new Date().toISOString(),
    status: "open",
    entrySignal: `OFI_${side.toUpperCase()}`,
    rsiAtEntry: rsi,
    macdAtEntry: ofiScore,
    emaSignalAtEntry: side === "buy" ? "bullish" : "bearish",
    fees,
  };

  const saved = storage.insertTrade(trade);
  openPositionId = saved.id;

  // Update portfolio snapshot
  const newCash = cash - (side === "buy" ? quantity * price + fees : 0);
  const cryptoValue = side === "buy" ? quantity * price : 0;
  const snap2 = storage.getLatestSnapshot();
  storage.insertPortfolioSnapshot({
    timestamp: new Date().toISOString(),
    totalValue: newCash + cryptoValue,
    cashBalance: newCash,
    cryptoValue,
    unrealizedPnl: 0,
    realizedPnl: snap2?.realizedPnl ?? 0,
    drawdown: snap2?.drawdown ?? 0,
  });

  traderEvents.emit("trade_opened", { ...saved, currentPrice: price });
  console.log(`[Beelzebub] OPEN ${side.toUpperCase()} ${symbol} @ $${price.toFixed(2)} | qty: ${quantity.toFixed(6)} | OFI: ${ofiScore.toFixed(3)}`);
}

function closePosition(reason: "take_profit" | "stop_loss" | "signal" | "timeout", currentPrice: number) {
  if (!openPositionId) return;
  const trade = storage.getTrades(200).find(t => t.id === openPositionId && t.status === "open");
  if (!trade) { openPositionId = null; return; }

  const config = storage.getBotConfig()!;
  const priceDiff = currentPrice - trade.entryPrice;
  const pnlRaw = trade.side === "buy" ? priceDiff * trade.quantity : -priceDiff * trade.quantity;
  const exitFees = trade.quantity * currentPrice * feeRate();
  const pnl = pnlRaw - exitFees - trade.fees;
  const pnlPct = (pnl / (trade.entryPrice * trade.quantity)) * 100;

  storage.updateTrade(openPositionId, {
    exitPrice: currentPrice,
    exitTime: new Date().toISOString(),
    pnl, pnlPercent: pnlPct,
    status: "closed",
    closeReason: reason,
    fees: trade.fees + exitFees,
  });

  // Update portfolio
  const snap = storage.getLatestSnapshot();
  const prevCash = snap?.cashBalance ?? config.initialCapital;
  const proceeds = trade.side === "buy" ? trade.quantity * currentPrice - exitFees : 0;
  const newCash = prevCash + proceeds;
  const totalValue = newCash;
  const realizedPnl = (snap?.realizedPnl ?? 0) + pnl;
  const peakValue = Math.max(totalValue, snap?.totalValue ?? 0);
  const drawdown = peakValue > 0 ? ((peakValue - totalValue) / peakValue) * 100 : 0;

  storage.insertPortfolioSnapshot({
    timestamp: new Date().toISOString(),
    totalValue, cashBalance: newCash,
    cryptoValue: 0, unrealizedPnl: 0,
    realizedPnl, drawdown,
  });

  traderEvents.emit("trade_closed", {
    id: openPositionId, symbol: trade.symbol, side: trade.side,
    entryPrice: trade.entryPrice, exitPrice: currentPrice,
    pnl, pnlPct, reason,
  });

  console.log(`[Beelzebub] CLOSE ${trade.symbol} @ $${currentPrice.toFixed(2)} | P&L: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(4)} (${pnlPct.toFixed(2)}%) | Reason: ${reason}`);
  openPositionId = null;
}

// ── Monitor open position ──────────────────────────────────────────────────────

function monitorPosition() {
  if (!openPositionId) return;
  const trade = storage.getTrades(200).find(t => t.id === openPositionId && t.status === "open");
  if (!trade) { openPositionId = null; return; }

  const config = storage.getBotConfig()!;
  const price = getLivePrice(trade.symbol);
  if (!price) return;

  const pricePct = ((price - trade.entryPrice) / trade.entryPrice) * 100;
  const profitPct = trade.side === "buy" ? pricePct : -pricePct;

  // Take profit
  if (profitPct >= config.takeProfit) {
    closePosition("take_profit", price);
    return;
  }

  // Stop loss
  if (profitPct <= -config.stopLoss) {
    closePosition("stop_loss", price);
    return;
  }

  // Signal reversal — exit if OFI flips strongly against us
  const engine = getEngine(trade.symbol + "USDT");
  const ofi = engine.getLatestOFI();
  if (ofi) {
    const ofiAgainstUs = trade.side === "buy" && ofi.ofiSmooth < -0.4;
    const ofiAgainstSell = trade.side === "sell" && ofi.ofiSmooth > 0.4;
    if (ofiAgainstUs || ofiAgainstSell) {
      closePosition("signal", price);
      return;
    }
  }

  // Max hold time: 10 minutes
  const heldMs = Date.now() - new Date(trade.entryTime).getTime();
  if (heldMs > 10 * 60 * 1000) {
    closePosition("timeout", price);
    return;
  }

  // Emit unrealized P&L update
  const unrealizedPnl = trade.side === "buy"
    ? (price - trade.entryPrice) * trade.quantity - trade.fees
    : (trade.entryPrice - price) * trade.quantity - trade.fees;
  traderEvents.emit("position_update", { id: openPositionId, currentPrice: price, unrealizedPnl, profitPct });
}

// ── Scan for new trades ────────────────────────────────────────────────────────

function scanAndTrade() {
  if (!isRunning) return;

  // Don't open another position if one is already open
  if (openPositionId !== null) return;

  const best = getBestCoin();
  if (!best || best.signalStrength < MIN_SIGNAL_STRENGTH) return;
  if (Math.abs(best.ofiScore) < MIN_OFI_THRESHOLD) return;
  if (best.executionQuality === "avoid") return;

  const price = getLivePrice(best.symbol.replace("USDT", ""));
  if (!price || price <= 0) return;

  // Determine side from OFI direction
  const side: "buy" | "sell" = best.ofiDirection === "buy" ? "buy" : "sell";

  // Update config symbol to the coin we're trading
  storage.upsertBotConfig({ symbol: best.displayName });

  openPosition(best.displayName, side, price, best.ofiScore, null);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function startLiveTrader() {
  if (isRunning) return;
  isRunning = true;
  console.log("[Beelzebub] Live paper trading loop STARTED");

  // Scan immediately, then on interval
  setTimeout(scanAndTrade, 3000); // wait 3s for engines to warm up
  scanTimer = setInterval(scanAndTrade, SCAN_INTERVAL_MS);
  monitorTimer = setInterval(monitorPosition, MONITOR_INTERVAL_MS);

  traderEvents.emit("started");
}

export function stopLiveTrader() {
  isRunning = false;
  if (scanTimer)   { clearInterval(scanTimer);   scanTimer = null; }
  if (monitorTimer){ clearInterval(monitorTimer); monitorTimer = null; }

  // Close any open position at current price
  if (openPositionId !== null) {
    const trade = storage.getTrades(200).find(t => t.id === openPositionId && t.status === "open");
    if (trade) {
      const price = getLivePrice(trade.symbol);
      if (price) closePosition("signal", price);
    }
  }

  console.log("[Beelzebub] Live paper trading loop STOPPED");
  traderEvents.emit("stopped");
}

export function isLiveTraderRunning() { return isRunning; }
export function getOpenPositionId()   { return openPositionId; }
