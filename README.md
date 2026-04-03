# TradeBot v2

Competition-grade crypto trading bot with Order Flow Intelligence, Momentum Ignition Detection, and real-time execution analysis.

**Stack:** Express · React · SQLite · WebSockets · Binance streams

---

## Deploy to Railway (5 minutes)

### 1. Push to GitHub

```bash
cd tradebot
git init
git add .
git commit -m "TradeBot v2"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/tradebot.git
git push -u origin main
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your `tradebot` repo
4. Railway auto-detects the `Dockerfile` and builds it
5. Go to **Settings → Networking → Generate Domain** to get a public URL

### 3. Add a persistent volume (keeps trade history across restarts)

1. In your Railway project, click **New → Volume**
2. Mount it at `/data`
3. Set environment variable: `DATABASE_URL=/data/tradebot.db`

That's it — your bot is live.

---

## Deploy to AWS (for the competition)

For the lowest latency to Binance, use **AWS Osaka (ap-northeast-3)**.

### Quick setup

```bash
# 1. Launch a c7i.2xlarge (or t3.medium for testing) in ap-northeast-3
# 2. SSH in, then:

sudo apt update && sudo apt install -y nodejs npm git
git clone https://github.com/YOUR_USERNAME/tradebot.git
cd tradebot
npm install
npm run build

# Install pm2 to keep it running
sudo npm install -g pm2
DATABASE_URL=/home/ubuntu/tradebot.db pm2 start dist/index.cjs --name tradebot
pm2 startup   # survives reboots
pm2 save
```

### Open the port

In your AWS Security Group, allow inbound **TCP 5000** from your IP (or 0.0.0.0/0 to share publicly).

Access the dashboard at: `http://YOUR_AWS_IP:5000`

### Expected latency to Binance from Osaka
- WebSocket connection: **10–14ms RTT**
- Order execution: **12–18ms**

---

## Run locally

```bash
npm install
npm run dev       # dev server with hot reload on :5000
```

```bash
npm run build
npm start         # production server on :5000
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `tradebot.db` | Path to SQLite database file |
| `NODE_ENV` | `development` | Set to `production` for the built server |
| `PORT` | `5000` | HTTP port |
