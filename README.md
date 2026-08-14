# HOUSIKA payment server

A small server that keeps your PayHero credentials off the public website and
proxies M-Pesa STK push requests on its behalf.

## Why this exists

`housika.html` runs entirely in visitors' browsers. Anything written into
that file — including API tokens — is visible to anyone who opens dev tools.
This server holds your PayHero credentials as environment variables instead,
so they're never shipped to the browser.

## 1. Get your PayHero channel ID

Log in to your PayHero dashboard → **Payment Channels** → **My Payment
Channels**, and copy the numeric ID of the channel (till, paybill, or bank
account) you want payments to land in. You'll need this for `PAYHERO_CHANNEL_ID`.

## 2. Configure

```
cd housika-server
npm install
cp .env.example .env
```

Open `.env` and fill in:

- `PAYHERO_BASIC_TOKEN` — the Basic Auth token from your PayHero dashboard (just the token, not the word "Basic")
- `PAYHERO_CHANNEL_ID` — from step 1
- `PUBLIC_CALLBACK_URL` — set this **after** you deploy (step 3), once you know your server's public address

## 3. Deploy

Any Node host works — Render, Railway, Fly.io, or your own VPS all have free
or cheap tiers. General steps for something like Render:

1. Push this `housika-server` folder to a GitHub repo (make sure `.env` is
   in `.gitignore` — never commit real credentials).
2. Create a new **Web Service** on Render, point it at the repo.
3. Set the environment variables from your `.env` in Render's dashboard
   instead of uploading the file.
4. Deploy. Render gives you a URL like `https://housika-api.onrender.com`.
5. Set `PUBLIC_CALLBACK_URL` (in Render's env vars) to
   `https://housika-api.onrender.com/api/payhero-callback`, and redeploy.

## 4. Connect the website

Open `housika.html`, find this line near the top of the `<script>` block:

```js
const HOUSIKA_API_BASE = ""; // e.g. "https://housika-api.onrender.com"
```

Set it to your deployed server's URL (no trailing slash). Real M-Pesa
payments switch on automatically — until it's set, the site uses a
simulated payment flow so you can demo it without a backend at all.

## Notes on going further

- The transaction store in `server.js` is in-memory and resets on restart —
  fine for testing, but swap it for a real database before relying on it.
- Log a few real PayHero callbacks during testing and check the field names
  in `/api/payhero-callback` match what PayHero actually sends; adjust if needed.
- Rotate your PayHero credentials if they were ever pasted anywhere public
  (chat messages, screenshots, public repos).
