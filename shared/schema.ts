import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Bot configuration
export const botConfig = sqliteTable("bot_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().default("TradeBot Alpha"),
  symbol: text("symbol").notNull().default("BTC"),
  pair: text("pair").notNull().default("BTC/USDT"),
  strategy: text("strategy").notNull().default("EMA_MACD_RSI"),
  demoMode: integer("demo_mode", { mode: "boolean" }).notNull().default(true),
  isRunning: integer("is_running", { mode: "boolean" }).notNull().default(false),
  initialCapital: real("initial_capital").notNull().default(10000),
  riskPerTrade: real("risk_per_trade").notNull().default(2), // percentage
  stopLoss: real("stop_loss").notNull().default(3), // percentage
  takeProfit: real("take_profit").notNull().default(6), // percentage
  emaFast: integer("ema_fast").notNull().default(9),
  emaSlow: integer("ema_slow").notNull().default(21),
  rsiPeriod: integer("rsi_period").notNull().default(14),
  rsiOverbought: real("rsi_overbought").notNull().default(70),
  rsiOversold: real("rsi_oversold").notNull().default(30),
  macdFast: integer("macd_fast").notNull().default(12),
  macdSlow: integer("macd_slow").notNull().default(26),
  macdSignal: integer("macd_signal").notNull().default(9),
  competitionStartTime: text("competition_start_time"),  // ISO string, set when bot starts in competition mode
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

// Trades (completed)
export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // 'buy' | 'sell'
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  quantity: real("quantity").notNull(),
  entryTime: text("entry_time").notNull(),
  exitTime: text("exit_time"),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  status: text("status").notNull().default("open"), // 'open' | 'closed' | 'stopped'
  closeReason: text("close_reason"), // 'take_profit' | 'stop_loss' | 'signal' | 'manual'
  entrySignal: text("entry_signal"),
  rsiAtEntry: real("rsi_at_entry"),
  macdAtEntry: real("macd_at_entry"),
  emaSignalAtEntry: text("ema_signal_at_entry"),
  fees: real("fees").notNull().default(0),
});

// Portfolio snapshots (for equity curve)
export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: text("timestamp").notNull(),
  totalValue: real("total_value").notNull(),
  cashBalance: real("cash_balance").notNull(),
  cryptoValue: real("crypto_value").notNull(),
  unrealizedPnl: real("unrealized_pnl").notNull().default(0),
  realizedPnl: real("realized_pnl").notNull().default(0),
  drawdown: real("drawdown").notNull().default(0),
});

// Price candles cache
export const priceCandles = sqliteTable("price_candles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  timestamp: text("timestamp").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: real("volume").notNull().default(0),
  ema9: real("ema9"),
  ema21: real("ema21"),
  rsi: real("rsi"),
  macd: real("macd"),
  macdSignal: real("macd_signal"),
  macdHistogram: real("macd_histogram"),
  signal: text("signal"), // 'buy' | 'sell' | null
});

// Schemas
export const insertBotConfigSchema = createInsertSchema(botConfig).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTradeSchema = createInsertSchema(trades).omit({ id: true });
export const insertPortfolioSnapshotSchema = createInsertSchema(portfolioSnapshots).omit({ id: true });
export const insertPriceCandleSchema = createInsertSchema(priceCandles).omit({ id: true });

// Types
export type BotConfig = typeof botConfig.$inferSelect;
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type PortfolioSnapshot = typeof portfolioSnapshots.$inferSelect;
export type InsertPortfolioSnapshot = z.infer<typeof insertPortfolioSnapshotSchema>;
export type PriceCandle = typeof priceCandles.$inferSelect;
export type InsertPriceCandle = z.infer<typeof insertPriceCandleSchema>;
