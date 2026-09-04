# Discord Activity & Server Monitor (Node.js)

A lightweight 24/7 background listener that monitors events across Discord servers your account is in and sends real-time alerts to a Discord Webhook.

---

## 🚀 Quick Start (Local Setup)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Open [`.env`](file:///.env) and set your credentials:
```env
USER_TOKEN=your_discord_account_token_here
WEBHOOK_URL=https://discord.com/api/webhooks/your/webhook/url/here
ALERT_KEYWORDS=urgent,alert,important
PORT=3000
```

### 3. Run the Monitor
```bash
npm start
```

---

## 🌐 24/7 Free Cloud Deployment

### Option A: Koyeb (Recommended - Always Free)
1. Push this project to your GitHub repository.
2. Log into [Koyeb.com](https://www.koyeb.com/).
3. Click **Create App** $\rightarrow$ select **GitHub**.
4. Select your repository.
5. In **Environment Variables**, add:
   - `USER_TOKEN` = `<your token>`
   - `WEBHOOK_URL` = `<your webhook URL>`
   - `ALERT_KEYWORDS` = `urgent,alert,important`
6. Click **Deploy**. Koyeb will run the app 24/7 with the built-in HTTP health check.

---

### Option B: VPS with PM2
If you have a Linux server or VPS:
```bash
# Install PM2 globally
npm install -g pm2

# Start and keep running forever
pm2 start monitor.js --name discord-monitor
pm2 startup
pm2 save
```
