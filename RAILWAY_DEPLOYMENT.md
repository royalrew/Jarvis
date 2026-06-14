# Railway Deployment Guide

This guide details how to deploy the **Jarvis Telegram Bot (headless worker)** and the **Trainer PWA (Next.js)** to Railway from this single monorepo.

---

## Architecture Overview

```
[Telegram App] <---> (Jarvis Telegram Bot - Railway Service 1)
                                |
                                v
                       [PostgreSQL Database]
                                ^
                                |
[Mobile / Browser] <---> (Trainer Next.js PWA - Railway Service 2)
```

---

## Step 1: Provision a PostgreSQL Database on Railway

Before deploying the services, we need to spin up a shared database on Railway:
1. Log in to your [Railway Dashboard](https://railway.app/).
2. Create a new project or open your existing project.
3. Click **+ New** -> **Database** -> **Add PostgreSQL**.
4. Railway will create a Postgres instance and automatically expose the connection variables (specifically `DATABASE_URL`).

---

## Step 2: Deploy Service 1 - Jarvis Telegram Bot (Worker)

This service will run the headless Telegram daemon.

1. Click **+ New** -> **GitHub Repo** -> Select your Jarvis repo.
2. Railway will create a service. Rename it to `jarvis-bot`.
3. In the **Settings** tab for `jarvis-bot`:
   - **Build Command**: Set to `npm run build` (this compiles TypeScript to `/dist` and copies assets).
   - **Start Command**: Set to `npm start` (this runs `node dist/bot.js` which polls Telegram).
4. In the **Variables** tab, add the following environment variables:
   - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}` (Click "Insert Variable" and select the Postgres database's URL).
   - `OPENAI_API_KEY`: *Your OpenAI API key*
   - `TELEGRAM_BOT_TOKEN`: *Your Telegram bot token from BotFather*
   - `TELEGRAM_USER_ID`: *Your personal numerical Telegram user ID*
   - `JARVIS_PROVIDER`: `auto`
   - `OPENAI_MODEL`: `gpt-4o-mini`
   - `JARVIS_TELEGRAM_VOICE`: `false` (Recommended first to test without latency/costs, change to `true` later if wanted).

---

## Step 3: Deploy Service 2 - Calisthenics PWA (Next.js)

This service will host the Next.js web interface accessible from your mobile phone.

1. Click **+ New** -> **GitHub Repo** -> Select the same Jarvis repository.
2. Railway will create a second service. Rename it to `jarvis-trainer`.
3. In the **Settings** tab for `jarvis-trainer`:
   - **Root Directory**: Set this to `/trainer`. This tells Railway to build and run out of the `trainer/` subdirectory.
   - **Build Command**: Leave as default (Next.js is automatically detected and built via Nixpacks).
   - **Start Command**: Leave as default (`next start`).
4. In the **Variables** tab, add:
   - `DATABASE_URL`: `${{Postgres.DATABASE_URL}}` (Link to the same shared Postgres database).
5. In the **Settings** tab:
   - Click **Generate Domain** under the **Networking** section to create a public URL (e.g., `jarvis-trainer.up.railway.app`).
   - Use this URL on your mobile phone to view and manage your calendar.

---

## Step 4: Run Initial DB Migration / Seed (First Deployment Only)

Once the Postgres database is online, you need to push the schema and seed the training tracks:

### Option A: Via Local Drizzle Push (Recommended)
From your local command prompt, target the Railway Postgres DB to initialize the tables:
```bash
# In the trainer directory
# Temporarily set the DATABASE_URL to your Railway TCP Connection string
$env:DATABASE_URL="postgres://postgres:PASSWORD@TCP_HOST:TCP_PORT/railway" 
npm run db:push
npm run db:seed
```

### Option B: Via Railway Shell / Custom Start Command
Alternatively, you can temporarily change the start command of `jarvis-trainer` on Railway to run migrations/seeds first, then change it back to `next start`.

---

## Security & Best Practices

- **Telegram Lock**: Always keep `TELEGRAM_USER_ID` set to your personal ID. The bot will reject messages from anyone else.
- **PII and Logs**: Since the Telegram bot runs in the cloud, all events and training logs are saved securely in the Postgres DB instead of local SQLite files.
