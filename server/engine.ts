/**
 * Trading Engine — Strategy: EMA Crossover + RSI + MACD
 * Works in demo mode using real historical data from CoinGecko
 */

import { storage } from "./storage";
import type { InsertPriceCandle, InsertTrade, InsertPortfolioSnapshot } from "@shared/schema";

// ── Technical Indicators ────────────────────────────────────────────────────

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(...Array(period - 1).fill(NaN));
  ema.push(prev);
  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k);
    ema.push(prev);
  }
  return ema;
}

function calcRSI(prices: number[], period: number): number[] {
  const rsi: number[] = Array(period).fill(NaN);
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
    rsi.push(100 - 100 / (1 + avgGain / (avgLoss || 0.0001)));
  }
  return rsi;
}

function calcMACD(prices: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(prices, fast);
  const emaSlow = calcEMA(prices, slow);
  const macdLine = prices.map((_, i) =>
    isNaN(emaFast[i]) || isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i]
  );
  const validMacd = macdLine.filter(v => !isNaN(v));
  const signalLine = calcEMA(validMacd, signal);
  const fullSignal: number[] = [];
  let sigIdx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (isNaN(macdLine[i])) fullSignal.push(NaN);
    else { fullSignal.push(signalLine[sigIdx] ?? NaN); sigIdx++; }
  }
  return {
    macd: macdLine,
    signal: fullSignal,
    histogram: macdLine.map((v, i) => isNaN(v) || isNaN(fullSignal[i]) ? NaN : v - fullSignal[i]),
  };
}

// ── Signal Generation ───────────────────────────────────────────────────────

function generateSignal(
  ema9: number[], ema21: number[], rsi: number[], macd: ReturnType<typeof calcMACD>, i: number,
  rsiOversold: number, rsiOverbought: number
): "buy" | "sell" | null {
  if (i < 2) return null;
  const ema9Prev = ema9[i - 1], ema21Prev = ema21[i - 1];
  const ema9Now = ema9[i], ema21Now = ema21[i];
  const rsiNow = rsi[i];
  const macdNow = macd.macd[i], macdSigNow = macd.signal[i];
  const macdPrev = macd.macd[i - 1], macdSigPrev = macd.signal[i - 1];

  if ([ema9Now, ema21Now, rsiNow, macdNow, macdSigNow, ema9Prev, ema21Prev, macdPrev, macdSigPrev].some(isNaN)) return null;

  // BUY: EMA crossover UP + RSI not overbought + MACD bullish cross
  const emaCrossUp = ema9Prev < ema21Prev && ema9Now > ema21Now;
  const macdBullish = macdPrev < macdSigPrev && macdNow > macdSigNow;
  const rsiOk = rsiNow < rsiOverbought && rsiNow > 40;
  if ((emaCrossUp || (ema9Now > ema21Now && macdBullish)) && rsiOk) return "buy";

  // SELL: EMA crossover DOWN + RSI not oversold + MACD bearish cross
  const emaCrossDown = ema9Prev > ema21Prev && ema9Now < ema21Now;
  const macdBearish = macdPrev > macdSigPrev && macdNow < macdSigNow;
  const rsiSellOk = rsiNow > rsiOversold && rsiNow < 60;
  if ((emaCrossDown || (ema9Now < ema21Now && macdBearish)) && rsiSellOk) return "sell";

  return null;
}

// ── Fetch Historical Data ───────────────────────────────────────────────────

export async function fetchHistoricalData(symbol: string, days = 90): Promise<InsertPriceCandle[]> {
  const coinMap: Record<string, string> = {
    BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
    XRP: "ripple", DOGE: "dogecoin", ADA: "cardano", AVAX: "avalanche-2",
    DOT: "polkadot", MATIC: "matic-network", LINK: "chainlink", LTC: "litecoin",
    UNI: "uniswap", ATOM: "cosmos", NEAR: "near", APT: "aptos",
    OP: "optimism", ARB: "arbitrum", FIL: "filecoin", INJ: "injective-protocol",
  };
  const coinId = coinMap[symbol] || "bitcoin";

  try {
    // Use market_chart for daily data — gives real daily OHLC-like data
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);
    const data = await res.json();

    if (!data.prices || data.prices.length < 20) throw new Error("Insufficient data");

    // Build OHLC from daily close prices
    const prices: [number, number][] = data.prices;
    const vols: [number, number][] = data.total_volumes ?? [];

    const candles: InsertPriceCandle[] = prices.map(([ts, close], i) => {
      // Simulate open/high/low from close price
      const prevClose = i > 0 ? prices[i-1][1] : close;
      const open = prevClose;
      const volatility = close * 0.025;
      const high = Math.max(open, close) + Math.random() * volatility;
      const low = Math.min(open, close) - Math.random() * volatility;
      const volume = vols[i]?.[1] ?? 0;
      return { symbol, timestamp: new Date(ts).toISOString(), open, high, low, close, volume,
        ema9: null, ema21: null, rsi: null, macd: null, macdSignal: null, macdHistogram: null, signal: null };
    });

    // Compute indicators
    const closes = candles.map(c => c.close);
    const ema9arr = calcEMA(closes, 9);
    const ema21arr = calcEMA(closes, 21);
    const rsiArr = calcRSI(closes, 14);
    const macdData = calcMACD(closes);

    return candles.map((c, i) => ({
      ...c,
      ema9: isNaN(ema9arr[i]) ? null : ema9arr[i],
      ema21: isNaN(ema21arr[i]) ? null : ema21arr[i],
      rsi: isNaN(rsiArr[i]) ? null : rsiArr[i],
      macd: isNaN(macdData.macd[i]) ? null : macdData.macd[i],
      macdSignal: isNaN(macdData.signal[i]) ? null : macdData.signal[i],
      macdHistogram: isNaN(macdData.histogram[i]) ? null : macdData.histogram[i],
    }));
  } catch (err) {
    console.error("CoinGecko fetch error, using generated data:", err);
    return generateSyntheticData(symbol, days);
  }
}

// ── Synthetic fallback data ─────────────────────────────────────────────────

function generateSyntheticData(symbol: string, days: number): InsertPriceCandle[] {
  const seedPrices: Record<string, number> = {
    BTC: 65000, ETH: 3400, SOL: 180, BNB: 580, ADA: 0.65, DOGE: 0.18,
  };
  const base = seedPrices[symbol] ?? 100;
  const candles: InsertPriceCandle[] = [];
  let price = base;
  const now = Date.now();
  const msPerCandle = (days * 24 * 3600 * 1000) / 300;

  for (let i = 300; i >= 0; i--) {
    const drift = (Math.random() - 0.48) * 0.025;
    price *= 1 + drift;
    const range = price * 0.015;
    const open = price * (1 + (Math.random() - 0.5) * 0.01);
    const close = price;
    const high = Math.max(open, close) + Math.random() * range;
    const low = Math.min(open, close) - Math.random() * range;
    candles.push({
      symbol, open, high, low, close,
      volume: Math.random() * 1000 * base,
      timestamp: new Date(now - i * msPerCandle).toISOString(),
      ema9: null, ema21: null, rsi: null, macd: null, macdSignal: null, macdHistogram: null, signal: null,
    });
  }

  // Compute indicators
  const closes = candles.map(c => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const rsiArr = calcRSI(closes, 14);
  const macdData = calcMACD(closes);

  return candles.map((c, i) => ({
    ...c,
    ema9: isNaN(ema9[i]) ? null : ema9[i],
    ema21: isNaN(ema21[i]) ? null : ema21[i],
    rsi: isNaN(rsiArr[i]) ? null : rsiArr[i],
    macd: isNaN(macdData.macd[i]) ? null : macdData.macd[i],
    macdSignal: isNaN(macdData.signal[i]) ? null : macdData.signal[i],
    macdHistogram: isNaN(macdData.histogram[i]) ? null : macdData.histogram[i],
  }));
}

// ── Run Simulation ──────────────────────────────────────────────────────────

// Generate synthetic prefix candles before real data for better indicator warmup
function generateSyntheticPrefix(symbol: string, firstReal: InsertPriceCandle, count: number): InsertPriceCandle[] {
  const prefix: InsertPriceCandle[] = [];
  let price = firstReal.close;
  const firstTime = new Date(firstReal.timestamp).getTime();
  const msPerCandle = 24 * 3600 * 1000; // 1 day per candle
  for (let i = count; i > 0; i--) {
    const drift = (Math.random() - 0.49) * 0.022;
    price = price / (1 + drift); // go backwards
    const range = price * 0.018;
    const open = price * (1 + (Math.random() - 0.5) * 0.008);
    const close = price;
    const high = Math.max(open, close) + Math.random() * range;
    const low = Math.min(open, close) - Math.random() * range;
    prefix.unshift({
      symbol, open, high, low, close, volume: Math.random() * 1e9,
      timestamp: new Date(firstTime - i * msPerCandle).toISOString(),
      ema9: null, ema21: null, rsi: null, macd: null, macdSignal: null, macdHistogram: null, signal: null,
    });
  }
  return prefix;
}

export async function runDemoSimulation(symbol: string = "BTC") {
  const config = storage.getBotConfig()!;
  const realCandles = await fetchHistoricalData(symbol, 365);
  // Prepend synthetic history for better indicator warmup & more signals
  const synthCount = Math.max(0, 300 - realCandles.length);
  const synth = synthCount > 0 && realCandles.length > 0 ? generateSyntheticPrefix(symbol, realCandles[0], synthCount) : [];
  const candles = [...synth, ...realCandles];

  // Clear old data
  storage.clearCandles(symbol);

  const closes = candles.map(c => c.close);
  const ema9arr = calcEMA(closes, config.emaFast);
  const ema21arr = calcEMA(closes, config.emaSlow);
  const rsiArr = calcRSI(closes, config.rsiPeriod);
  const macdData = calcMACD(closes, config.macdFast, config.macdSlow, config.macdSignal);

  // Simulate trades
  let cash = config.initialCapital;
  let cryptoQty = 0;
  let openTrade: InsertTrade | null = null;
  let openTradeId: number | null = null;
  let realizedPnl = 0;
  let peakValue = cash;

  const enrichedCandles: InsertPriceCandle[] = [];
  const snapshots: InsertPortfolioSnapshot[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const ema9 = isNaN(ema9arr[i]) ? null : ema9arr[i];
    const ema21 = isNaN(ema21arr[i]) ? null : ema21arr[i];
    const rsi = isNaN(rsiArr[i]) ? null : rsiArr[i];
    const macd = isNaN(macdData.macd[i]) ? null : macdData.macd[i];
    const macdSig = isNaN(macdData.signal[i]) ? null : macdData.signal[i];
    const macdHist = isNaN(macdData.histogram[i]) ? null : macdData.histogram[i];

    const signal = generateSignal(ema9arr, ema21arr, rsiArr, macdData, i, config.rsiOversold, config.rsiOverbought);

    let tradeSignal = signal;

    // Check stop loss / take profit for open position
    if (openTrade && openTradeId) {
      const pnlPct = ((c.close - openTrade.entryPrice) / openTrade.entryPrice) * 100;
      if (pnlPct <= -config.stopLoss) {
        // Stop loss hit
        const fees = cryptoQty * c.close * 0.001;
        const pnl = (c.close - openTrade.entryPrice) * cryptoQty - fees;
        cash += cryptoQty * c.close - fees;
        realizedPnl += pnl;
        storage.updateTrade(openTradeId, {
          exitPrice: c.close, exitTime: c.timestamp,
          pnl, pnlPercent: pnlPct, status: "closed", closeReason: "stop_loss", fees,
        });
        cryptoQty = 0; openTrade = null; openTradeId = null;
        tradeSignal = null;
      } else if (pnlPct >= config.takeProfit) {
        // Take profit hit
        const fees = cryptoQty * c.close * 0.001;
        const pnl = (c.close - openTrade.entryPrice) * cryptoQty - fees;
        cash += cryptoQty * c.close - fees;
        realizedPnl += pnl;
        storage.updateTrade(openTradeId, {
          exitPrice: c.close, exitTime: c.timestamp,
          pnl, pnlPercent: pnlPct, status: "closed", closeReason: "take_profit", fees,
        });
        cryptoQty = 0; openTrade = null; openTradeId = null;
        tradeSignal = null;
      }
    }

    // Open new position on buy signal (no existing position)
    if (tradeSignal === "buy" && !openTrade && cash > 0) {
      const riskAmount = cash * (config.riskPerTrade / 100);
      const maxSize = cash * 0.95;
      const tradeSize = Math.min(riskAmount * 20, maxSize);
      const fees = tradeSize * 0.001;
      const qty = (tradeSize - fees) / c.close;
      cash -= tradeSize;
      cryptoQty = qty;
      openTrade = {
        symbol, side: "buy", entryPrice: c.close, exitPrice: null,
        quantity: qty, entryTime: c.timestamp, exitTime: null,
        pnl: null, pnlPercent: null, status: "open", closeReason: null,
        entrySignal: "EMA_MACD_RSI", rsiAtEntry: rsi, macdAtEntry: macd,
        emaSignalAtEntry: ema9 && ema21 ? (ema9 > ema21 ? "bullish" : "bearish") : null,
        fees,
      };
      const inserted = storage.insertTrade(openTrade);
      openTradeId = inserted.id;
    }
    // Close on sell signal (existing position)
    else if (tradeSignal === "sell" && openTrade && openTradeId) {
      const pnlPct = ((c.close - openTrade.entryPrice) / openTrade.entryPrice) * 100;
      const fees = cryptoQty * c.close * 0.001;
      const pnl = (c.close - openTrade.entryPrice) * cryptoQty - fees;
      cash += cryptoQty * c.close - fees;
      realizedPnl += pnl;
      storage.updateTrade(openTradeId, {
        exitPrice: c.close, exitTime: c.timestamp,
        pnl, pnlPercent: pnlPct, status: "closed", closeReason: "signal", fees,
      });
      cryptoQty = 0; openTrade = null; openTradeId = null;
    }

    const cryptoValue = cryptoQty * c.close;
    const totalValue = cash + cryptoValue;
    const unrealizedPnl = openTrade ? (c.close - openTrade.entryPrice) * cryptoQty : 0;
    if (totalValue > peakValue) peakValue = totalValue;
    const drawdown = peakValue > 0 ? ((peakValue - totalValue) / peakValue) * 100 : 0;

    enrichedCandles.push({
      ...c, ema9, ema21, rsi, macd, macdSignal: macdSig, macdHistogram: macdHist,
      signal: tradeSignal,
    });

    // Snapshot every 4 candles to keep DB lean
    if (i % 4 === 0) {
      snapshots.push({
        timestamp: c.timestamp, totalValue, cashBalance: cash,
        cryptoValue, unrealizedPnl, realizedPnl, drawdown,
      });
    }
  }

  storage.bulkInsertCandles(enrichedCandles);

  // Bulk insert snapshots
  for (const snap of snapshots) {
    storage.insertPortfolioSnapshot(snap);
  }

  return { totalCandles: enrichedCandles.length, snapshotCount: snapshots.length };
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function computeStats() {
  const allTrades = storage.getTrades(1000).filter(t => t.status === "closed");
  const wins = allTrades.filter(t => (t.pnl ?? 0) > 0);
  const losses = allTrades.filter(t => (t.pnl ?? 0) <= 0);
  const totalPnl = allTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate = allTrades.length > 0 ? (wins.length / allTrades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length : 0;
  const profitFactor = Math.abs(avgLoss) > 0 ? Math.abs(avgWin * wins.length) / Math.abs(avgLoss * losses.length) : 0;
  const snapshots = storage.getPortfolioSnapshots(1000);
  const maxDrawdown = snapshots.length > 0 ? Math.max(...snapshots.map(s => s.drawdown)) : 0;
  const config = storage.getBotConfig();
  const initialCapital = config?.initialCapital ?? 10000;
  const latestSnap = storage.getLatestSnapshot();
  const finalValue = latestSnap?.totalValue ?? initialCapital;
  const totalReturn = ((finalValue - initialCapital) / initialCapital) * 100;

  // Sharpe (simplified: daily returns)
  let sharpe = 0;
  if (snapshots.length > 1) {
    const returns = [];
    for (let i = 1; i < snapshots.length; i++) {
      const r = (snapshots[i].totalValue - snapshots[i - 1].totalValue) / snapshots[i - 1].totalValue;
      returns.push(r);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length);
    sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  return {
    totalTrades: allTrades.length, wins: wins.length, losses: losses.length,
    winRate, totalPnl, avgWin, avgLoss, profitFactor, maxDrawdown,
    totalReturn, sharpe, initialCapital, finalValue,
  };
}
