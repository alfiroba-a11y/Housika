# HOUSIKA payment server

This folder contains both the website (`housika.html`) and the server that
keeps your PayHero credentials off it. Deploy this whole folder as one
Render (or similar) service — visiting the deployed URL shows the site
itself; `/health` shows a plain "running" check separate from that.

## Why the server exists

`housika.html` runs entirely in visitors' browsers. Anything written into
that file — including API tokens — is visible to anyone who opens dev tools.
The server holds your PayHero credentials as environment variables instead,
so they're never shipped to the browser. It also now serves `housika.html`
itself at the root URL, so you only need one deployment, not two.

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

## 3. Deploy — this whole folder, as one service

Any Node host works — Render, Railway, Fly.io, or your own VPS all have free
or cheap tiers. `housika.html` must stay in this same folder, next to
`server.js` — the server serves it directly. General steps for something
like Render:

1. Push this entire `housika-server` folder (including `housika.html`) to a
   GitHub repo (make sure `.env` is in `.gitignore` — never commit real
   credentials).
2. Create a new **Web Service** on Render, point it at the repo.
3. Set the environment variables from your `.env` in Render's dashboard
   instead of uploading the file.
4. Deploy. Render gives you a URL like `https://housika.onrender.com` —
   visiting it now shows the actual HOUSIKA website. `/health` shows the
   plain "server is running" check.
5. Set `PUBLIC_CALLBACK_URL` (in Render's env vars) to
   `https://housika.onrender.com/api/payhero-callback`, and redeploy.

## 4. Confirm the site is talking to itself

Inside `housika.html`, near the top of the `<script>` block, this line
should already point at your deployed URL:

```js
const HOUSIKA_API_BASE = "https://housika.onrender.com";
```

Since the site and server are now the same deployment, this will always be
correct as long as you deploy this folder as-is. If you ever move the site
to a different host than the server, update this line to wherever the
server ends up living, and leave it blank to fall back to simulated demo
payments.

## Notes on going further

- The transaction store in `server.js` is in-memory and resets on restart —
  fine for testing, but swap it for a real database before relying on it.
- Log a few real PayHero callbacks during testing and check the field names
  in `/api/payhero-callback` match what PayHero actually sends; adjust if needed.
- Rotate your PayHero credentials if they were ever pasted anywhere public
  (chat messages, screenshots, public repos).
