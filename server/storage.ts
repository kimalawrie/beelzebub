import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, asc, and, gte } from "drizzle-orm";
import {
  botConfig, trades, portfolioSnapshots, priceCandles,
  type BotConfig, type InsertBotConfig,
  type Trade, type InsertTrade,
  type PortfolioSnapshot, type InsertPortfolioSnapshot,
  type PriceCandle, type InsertPriceCandle,
} from "@shared/schema";

const dbPath = process.env.DATABASE_URL ?? "tradebot.db";
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite);

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS bot_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'TradeBot Alpha',
    symbol TEXT NOT NULL DEFAULT 'BTC',
    pair TEXT NOT NULL DEFAULT 'BTC/USDT',
    strategy TEXT NOT NULL DEFAULT 'EMA_MACD_RSI',
    demo_mode INTEGER NOT NULL DEFAULT 1,
    is_running INTEGER NOT NULL DEFAULT 0,
    initial_capital REAL NOT NULL DEFAULT 10000,
    risk_per_trade REAL NOT NULL DEFAULT 2,
    stop_loss REAL NOT NULL DEFAULT 3,
    take_profit REAL NOT NULL DEFAULT 6,
    ema_fast INTEGER NOT NULL DEFAULT 9,
    ema_slow INTEGER NOT NULL DEFAULT 21,
    rsi_period INTEGER NOT NULL DEFAULT 14,
    rsi_overbought REAL NOT NULL DEFAULT 70,
    rsi_oversold REAL NOT NULL DEFAULT 30,
    macd_fast INTEGER NOT NULL DEFAULT 12,
    macd_slow INTEGER NOT NULL DEFAULT 26,
    macd_signal INTEGER NOT NULL DEFAULT 9,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL,
    quantity REAL NOT NULL,
    entry_time TEXT NOT NULL,
    exit_time TEXT,
    pnl REAL,
    pnl_percent REAL,
    status TEXT NOT NULL DEFAULT 'open',
    close_reason TEXT,
    entry_signal TEXT,
    rsi_at_entry REAL,
    macd_at_entry REAL,
    ema_signal_at_entry TEXT,
    fees REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    total_value REAL NOT NULL,
    cash_balance REAL NOT NULL,
    crypto_value REAL NOT NULL,
    unrealized_pnl REAL NOT NULL DEFAULT 0,
    realized_pnl REAL NOT NULL DEFAULT 0,
    drawdown REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS price_candles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL NOT NULL DEFAULT 0,
    ema9 REAL,
    ema21 REAL,
    rsi REAL,
    macd REAL,
    macd_signal REAL,
    macd_histogram REAL,
    signal TEXT
  );
`);

export interface IStorage {
  // Bot config
  getBotConfig(): BotConfig | undefined;
  upsertBotConfig(config: Partial<InsertBotConfig>): BotConfig;

  // Trades
  getTrades(limit?: number): Trade[];
  getOpenTrade(): Trade | undefined;
  insertTrade(trade: InsertTrade): Trade;
  updateTrade(id: number, updates: Partial<Trade>): Trade | undefined;

  // Portfolio
  getPortfolioSnapshots(limit?: number): PortfolioSnapshot[];
  insertPortfolioSnapshot(snap: InsertPortfolioSnapshot): PortfolioSnapshot;
  getLatestSnapshot(): PortfolioSnapshot | undefined;

  // Candles
  getCandles(symbol: string, limit?: number): PriceCandle[];
  insertCandle(candle: InsertPriceCandle): PriceCandle;
  clearCandles(symbol: string): void;
  bulkInsertCandles(candles: InsertPriceCandle[]): void;
}

export const storage: IStorage = {
  getBotConfig() {
    const configs = db.select().from(botConfig).all();
    if (configs.length === 0) {
      // Seed default config
      db.insert(botConfig).values({
        name: "TradeBot Alpha",
        symbol: "BTC",
        pair: "BTC/USDT",
        strategy: "EMA_MACD_RSI",
        demoMode: true,
        isRunning: false,
        initialCapital: 10000,
        riskPerTrade: 2,
        stopLoss: 3,
        takeProfit: 6,
        emaFast: 9,
        emaSlow: 21,
        rsiPeriod: 14,
        rsiOverbought: 70,
        rsiOversold: 30,
        macdFast: 12,
        macdSlow: 26,
        macdSignal: 9,
      }).run();
      return db.select().from(botConfig).get();
    }
    return configs[0];
  },

  upsertBotConfig(config) {
    const existing = db.select().from(botConfig).get();
    if (existing) {
      db.update(botConfig).set({ ...config, updatedAt: new Date().toISOString() }).where(eq(botConfig.id, existing.id)).run();
      return db.select().from(botConfig).where(eq(botConfig.id, existing.id)).get()!;
    } else {
      db.insert(botConfig).values(config as InsertBotConfig).run();
      return db.select().from(botConfig).get()!;
    }
  },

  getTrades(limit = 200) {
    return db.select().from(trades).orderBy(desc(trades.id)).limit(limit).all();
  },

  getOpenTrade() {
    return db.select().from(trades).where(eq(trades.status, "open")).get();
  },

  insertTrade(trade) {
    db.insert(trades).values(trade).run();
    return db.select().from(trades).orderBy(desc(trades.id)).get()!;
  },

  updateTrade(id, updates) {
    db.update(trades).set(updates).where(eq(trades.id, id)).run();
    return db.select().from(trades).where(eq(trades.id, id)).get();
  },

  getPortfolioSnapshots(limit = 500) {
    return db.select().from(portfolioSnapshots).orderBy(asc(portfolioSnapshots.id)).limit(limit).all();
  },

  getLatestSnapshot() {
    return db.select().from(portfolioSnapshots).orderBy(desc(portfolioSnapshots.id)).get();
  },

  insertPortfolioSnapshot(snap) {
    db.insert(portfolioSnapshots).values(snap).run();
    return db.select().from(portfolioSnapshots).orderBy(desc(portfolioSnapshots.id)).get()!;
  },

  getCandles(symbol, limit = 200) {
    return db.select().from(priceCandles)
      .where(eq(priceCandles.symbol, symbol))
      .orderBy(asc(priceCandles.id))
      .limit(limit)
      .all();
  },

  insertCandle(candle) {
    db.insert(priceCandles).values(candle).run();
    return db.select().from(priceCandles).orderBy(desc(priceCandles.id)).get()!;
  },

  clearCandles(symbol) {
    db.delete(priceCandles).where(eq(priceCandles.symbol, symbol)).run();
  },

  bulkInsertCandles(candles) {
    const stmt = sqlite.prepare(`
      INSERT INTO price_candles (symbol, timestamp, open, high, low, close, volume, ema9, ema21, rsi, macd, macd_signal, macd_histogram, signal)
      VALUES (@symbol, @timestamp, @open, @high, @low, @close, @volume, @ema9, @ema21, @rsi, @macd, @macdSignal, @macdHistogram, @signal)
    `);
    const insertMany = sqlite.transaction((rows: InsertPriceCandle[]) => {
      for (const row of rows) {
        stmt.run({
          symbol: row.symbol,
          timestamp: row.timestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume ?? 0,
          ema9: row.ema9 ?? null,
          ema21: row.ema21 ?? null,
          rsi: row.rsi ?? null,
          macd: row.macd ?? null,
          macdSignal: row.macdSignal ?? null,
          macdHistogram: row.macdHistogram ?? null,
          signal: row.signal ?? null,
        });
      }
    });
    insertMany(candles);
  },
};
