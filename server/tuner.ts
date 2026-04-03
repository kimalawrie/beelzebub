/**
 * Beelzebub Auto Parameter Tuner
 *
 * Runs a grid search over strategy parameters, scores each combination
 * using a composite fitness function, and persists the best result.
 *
 * Parameters tested:
 * - EMA fast/slow periods
 * - RSI period + overbought/oversold thresholds
 * - Stop loss % + Take profit %
 * - OFI entry threshold
 * - Min signal strength
 *
 * Fitness score = Sharpe * 0.4 + WinRate * 0.3 + ProfitFactor * 0.2 - MaxDrawdown * 0.1
 */

import { fetchHistoricalData, runSimulationWithParams, buildTunerCandles } from "./engine";
import { storage } from "./storage";
import { EventEmitter } from "events";

export const tunerEvents = new EventEmitter();

// ── Parameter Space ───────────────────────────────────────────────────────────

interface TunerParams {
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  stopLoss: number;
  takeProfit: number;
  ofiThreshold: number;
  minSignalStrength: number;
}

export interface TunerResult {
  params: TunerParams;
  sharpe: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  totalReturn: number;
  totalTrades: number;
  fitnessScore: number;
  rank: number;
}

interface TunerState {
  running: boolean;
  progress: number;       // 0-100
  totalRuns: number;
  completedRuns: number;
  results: TunerResult[];
  bestParams: TunerParams | null;
  bestScore: number;
  startedAt: string | null;
  completedAt: string | null;
  symbol: string;
  status: "idle" | "running" | "complete" | "error";
  error?: string;
}

const state: TunerState = {
  running: false, progress: 0, totalRuns: 0, completedRuns: 0,
  results: [], bestParams: null, bestScore: -Infinity,
  startedAt: null, completedAt: null, symbol: "BTC",
  status: "idle",
};

export function getTunerState(): TunerState { return { ...state, results: state.results.slice(0, 20) }; }

// ── Parameter Grid ────────────────────────────────────────────────────────────

function buildParamGrid(): TunerParams[] {
  const grid: TunerParams[] = [];

  const emaFasts    = [7, 9, 12];
  const emaSlows    = [21, 26, 34];
  const rsiPeriods  = [14];
  const rsiOBs      = [65, 70, 75];
  const rsiOSs      = [25, 30, 35];
  const stopLosses  = [2, 3, 4];
  const takeProfits = [4, 6, 9];

  for (const emaFast of emaFasts) {
    for (const emaSlow of emaSlows) {
      if (emaFast >= emaSlow) continue;
      for (const rsiOB of rsiOBs) {
        for (const rsiOS of rsiOSs) {
          for (const sl of stopLosses) {
            for (const tp of takeProfits) {
              if (tp <= sl) continue;
              grid.push({
                emaFast, emaSlow,
                rsiPeriod: 14,
                rsiOverbought: rsiOB,
                rsiOversold: rsiOS,
                stopLoss: sl,
                takeProfit: tp,
                ofiThreshold: 0.15,
                minSignalStrength: 35,
              });
            }
          }
        }
      }
    }
  }

  // Shuffle and cap at 50 so it doesn't run forever
  for (let i = grid.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [grid[i], grid[j]] = [grid[j], grid[i]];
  }

  return grid.slice(0, 50);
}

// ── Fitness Function ──────────────────────────────────────────────────────────

function score(r: {
  sharpe: number; winRate: number; profitFactor: number;
  maxDrawdown: number; totalTrades: number; totalReturn: number;
}): number {
  if (r.totalTrades < 3) return -100; // not enough trades to be meaningful
  const sharpeNorm = Math.min(r.sharpe, 5) / 5;                // 0-1
  const winNorm    = Math.min(r.winRate, 100) / 100;           // 0-1
  const pfNorm     = Math.min(r.profitFactor, 4) / 4;          // 0-1
  const ddPenalty  = Math.min(r.maxDrawdown, 30) / 30;         // 0-1 (higher = worse)
  return (sharpeNorm * 0.40) + (winNorm * 0.30) + (pfNorm * 0.20) - (ddPenalty * 0.10);
}

// ── Run Tuner ─────────────────────────────────────────────────────────────────

export async function runTuner(symbol: string = "BTC"): Promise<void> {
  if (state.running) return;

  state.running = true;
  state.status = "running";
  state.progress = 0;
  state.completedRuns = 0;
  state.results = [];
  state.bestParams = null;
  state.bestScore = -Infinity;
  state.startedAt = new Date().toISOString();
  state.completedAt = null;
  state.symbol = symbol;
  state.error = undefined;

  tunerEvents.emit("started", { symbol });

  try {
    // Fetch + pad historical data once — reuse for all runs
    console.log(`[Tuner] Fetching historical data for ${symbol}...`);
    const candles = await buildTunerCandles(symbol);
    if (!candles || candles.length < 30) throw new Error("Not enough historical data");
    console.log(`[Tuner] Got ${candles.length} candles for simulation`);

    const grid = buildParamGrid();
    state.totalRuns = grid.length;
    console.log(`[Tuner] Running ${grid.length} parameter combinations...`);

    for (let i = 0; i < grid.length; i++) {
      const params = grid[i];
      try {
        const result = runSimulationWithParams(candles, params);
        const fitness = score(result);

        const tunerResult: TunerResult = {
          params,
          sharpe: result.sharpe,
          winRate: result.winRate,
          profitFactor: result.profitFactor,
          maxDrawdown: result.maxDrawdown,
          totalReturn: result.totalReturn,
          totalTrades: result.totalTrades,
          fitnessScore: fitness,
          rank: 0,
        };

        state.results.push(tunerResult);

        if (fitness > state.bestScore) {
          state.bestScore = fitness;
          state.bestParams = params;
          tunerEvents.emit("new_best", tunerResult);
          console.log(`[Tuner] New best: score=${fitness.toFixed(3)} EMA${params.emaFast}/${params.emaSlow} RSI${params.rsiOversold}/${params.rsiOverbought} SL${params.stopLoss}% TP${params.takeProfit}%`);
        }
      } catch {
        // Skip failed combos silently
      }

      state.completedRuns = i + 1;
      state.progress = Math.round(((i + 1) / grid.length) * 100);
      tunerEvents.emit("progress", { completed: i + 1, total: grid.length, progress: state.progress });

      // Tiny delay to avoid blocking the event loop
      await new Promise(r => setTimeout(r, 10));
    }

    // Sort and rank results
    state.results.sort((a, b) => b.fitnessScore - a.fitnessScore);
    state.results.forEach((r, i) => r.rank = i + 1);

    // Auto-apply best params to config
    if (state.bestParams) {
      const bp = state.bestParams;
      storage.upsertBotConfig({
        emaFast: bp.emaFast,
        emaSlow: bp.emaSlow,
        rsiPeriod: bp.rsiPeriod,
        rsiOverbought: bp.rsiOverbought,
        rsiOversold: bp.rsiOversold,
        stopLoss: bp.stopLoss,
        takeProfit: bp.takeProfit,
      });
      console.log(`[Tuner] Best params applied to config automatically.`);
    }

    state.status = "complete";
    state.completedAt = new Date().toISOString();
    tunerEvents.emit("complete", { best: state.bestParams, score: state.bestScore, runs: state.completedRuns });
    console.log(`[Tuner] Done. Best score: ${state.bestScore.toFixed(3)}`);

  } catch (e: any) {
    state.status = "error";
    state.error = e.message;
    tunerEvents.emit("error", { message: e.message });
    console.error(`[Tuner] Error:`, e.message);
  } finally {
    state.running = false;
  }
}
