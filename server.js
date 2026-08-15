/**
 * HOUSIKA payment server
 * ----------------------
 * Holds your PayHero credentials as environment variables (never in code,
 * never committed to git) and exposes three endpoints for the HOUSIKA
 * website to call:
 *
 *   POST /api/stk-push            -> starts an M-Pesa STK push via PayHero
 *   POST /api/payhero-callback    -> PayHero posts the payment result here
 *   GET  /api/stk-status/:ref     -> the website polls this for the result
 *
 * Requires Node.js 18+ (for global fetch). Run locally with:
 *   npm install
 *   cp .env.example .env   (then fill in your real values)
 *   npm start
 */

require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Serves housika.html (and any other static files placed in this same
// folder) at the root URL. This file MUST sit next to server.js for this
// to work — same folder, deployed together.
app.use(express.static(__dirname));

const {
  PAYHERO_BASIC_TOKEN,   // the "Authorization: Basic <token>" value from your PayHero dashboard
  PAYHERO_CHANNEL_ID,    // your Payment Channels -> My Payment Channels ID in PayHero
  PAYHERO_ACCOUNT_ID,    // your PayHero account ID (shown alongside your channel in the dashboard)
  PUBLIC_CALLBACK_URL,   // e.g. https://your-deployed-server.com/api/payhero-callback
  PORT = 4000
} = process.env;

if (!PAYHERO_BASIC_TOKEN || !PAYHERO_CHANNEL_ID || !PAYHERO_ACCOUNT_ID || !PUBLIC_CALLBACK_URL) {
  console.warn(
    "\n⚠️  Missing PayHero configuration.\n" +
    "   Set PAYHERO_BASIC_TOKEN, PAYHERO_CHANNEL_ID, PAYHERO_ACCOUNT_ID and PUBLIC_CALLBACK_URL in your .env file.\n" +
    "   See .env.example and README.md for details.\n"
  );
}

// Demo-grade storage for transaction status, keyed by our own reference.
// Swap this for a real database (Postgres, SQLite, etc.) before going live —
// this in-memory map resets whenever the server restarts.
const transactions = new Map();

// PayHero expects Kenyan numbers in LOCAL format (e.g. 0708344101) per their
// own API docs — not the 254-prefixed international format. Tenants may type
// spaces, dashes, a leading 254, or a leading +254, so normalize all of that
// down to the plain 07XXXXXXXX / 01XXXXXXXX shape PayHero wants.
function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, ""); // strip spaces, +, dashes etc.
  if (digits.startsWith("254")) return "0" + digits.slice(3);
  if (digits.startsWith("0")) return digits;
  if (digits.startsWith("7") || digits.startsWith("1")) return "0" + digits;
  return digits;
}

app.post("/api/stk-push", async (req, res) => {
  const { phone, amount, reference } = req.body || {};
  if (!phone || !amount || !reference) {
    return res.status(400).json({ error: "phone, amount and reference are required" });
  }

  const phoneNumber = normalizePhone(phone);
  if (!/^0(7|1)\d{8}$/.test(phoneNumber)) {
    return res.status(400).json({ error: `"${phone}" doesn't look like a valid Kenyan phone number` });
  }

  const channelId = Number(PAYHERO_CHANNEL_ID);
  const accountId = Number(PAYHERO_ACCOUNT_ID);
  if (!Number.isFinite(channelId) || !Number.isFinite(accountId)) {
    console.error(
      `PAYHERO_CHANNEL_ID or PAYHERO_ACCOUNT_ID isn't a valid number. ` +
      `Got PAYHERO_CHANNEL_ID="${PAYHERO_CHANNEL_ID}" PAYHERO_ACCOUNT_ID="${PAYHERO_ACCOUNT_ID}" ` +
      `— check for stray spaces, quotes, or non-digit characters in Render's Environment tab.`
    );
    return res.status(500).json({ error: "Server is misconfigured: PAYHERO_CHANNEL_ID or PAYHERO_ACCOUNT_ID is not a valid number." });
  }

  const payload = {
    amount: Math.round(Number(amount)),
    phone_number: phoneNumber,
    provider: "m-pesa",
    network_code: "63902",
    channel_id: channelId,
    account_id: accountId,
    external_reference: reference,
    callback_url: PUBLIC_CALLBACK_URL
  };
  console.log("Sending to PayHero:", JSON.stringify(payload));

  try {
    // Accept-Encoding: identity avoids a Node/undici bug where a gzip-encoded
    // response that gets interrupted mid-stream crashes with a cryptic
    // "incorrect header check" / Z_DATA_ERROR instead of a clean network error.
    // AbortController gives us a real timeout instead of hanging indefinitely
    // if PayHero (or the network path to it) stalls.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    let payheroRes;
    try {
      payheroRes = await fetch("https://api.payhero.africa/api/v2/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${PAYHERO_BASIC_TOKEN}`,
          "Accept-Encoding": "identity"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await payheroRes.json();

    if (!payheroRes.ok) {
      console.error("PayHero rejected the request:", data);
      return res.status(502).json({ error: "PayHero rejected the request", details: data });
    }

    transactions.set(reference, { status: "PENDING", createdAt: Date.now() });
    res.json({ ok: true, payhero: data });
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("Timed out waiting for PayHero to respond");
      return res.status(504).json({ error: "Timed out waiting for PayHero to respond. Try again." });
    }
    console.error("Failed to reach PayHero:", err);
    res.status(500).json({ error: "Failed to reach PayHero" });
  }
});

// PayHero posts the payment result here. Set this exact URL (yourdomain +
// /api/payhero-callback) as PUBLIC_CALLBACK_URL in your .env, and it's what
// gets sent to PayHero on every /api/stk-push request.
//
// Real payload shape from PayHero docs:
// { success, status: "success", reference, external_reference, amount,
//   currency, transaction_id, transaction_date, transaction_type,
//   provider_reference, provider, callback_urls }
app.post("/api/payhero-callback", (req, res) => {
  const body = req.body || {};
  console.log("PayHero callback received:", JSON.stringify(body));

  const reference = body.external_reference || body.reference;
  const success = body.success === true || (body.status || "").toString().toUpperCase() === "SUCCESS";

  if (reference) {
    transactions.set(reference, {
      status: success ? "SUCCESS" : "FAILED",
      raw: body,
      createdAt: Date.now()
    });
  }
  res.sendStatus(200);
});

app.get("/api/stk-status/:reference", (req, res) => {
  const tx = transactions.get(req.params.reference);
  res.json(tx || { status: "PENDING" });
});

// The actual HOUSIKA website. Requires housika.html to be deployed in the
// same folder as this server.js file.
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "housika.html")));

// Health check — visit /health to confirm the server process itself is up,
// separate from whether housika.html is present.
app.get("/health", (_req, res) => res.send("HOUSIKA payment server is running."));

app.listen(PORT, () => console.log(`HOUSIKA payment server listening on port ${PORT}`));
