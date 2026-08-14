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
  PUBLIC_CALLBACK_URL,   // e.g. https://your-deployed-server.com/api/payhero-callback
  PORT = 4000
} = process.env;

if (!PAYHERO_BASIC_TOKEN || !PAYHERO_CHANNEL_ID || !PUBLIC_CALLBACK_URL) {
  console.warn(
    "\n⚠️  Missing PayHero configuration.\n" +
    "   Set PAYHERO_BASIC_TOKEN, PAYHERO_CHANNEL_ID and PUBLIC_CALLBACK_URL in your .env file.\n" +
    "   See .env.example and README.md for details.\n"
  );
}

// Demo-grade storage for transaction status, keyed by our own reference.
// Swap this for a real database (Postgres, SQLite, etc.) before going live —
// this in-memory map resets whenever the server restarts.
const transactions = new Map();

app.post("/api/stk-push", async (req, res) => {
  const { phone, amount, reference, customerName } = req.body || {};
  if (!phone || !amount || !reference) {
    return res.status(400).json({ error: "phone, amount and reference are required" });
  }

  try {
    const payheroRes = await fetch("https://backend.payhero.co.ke/api/v2/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${PAYHERO_BASIC_TOKEN}`
      },
      body: JSON.stringify({
        amount: Math.round(Number(amount)),
        phone_number: phone,
        channel_id: Number(PAYHERO_CHANNEL_ID),
        provider: "m-pesa",
        external_reference: reference,
        customer_name: customerName || "HOUSIKA tenant",
        callback_url: PUBLIC_CALLBACK_URL
      })
    });

    const data = await payheroRes.json();

    if (!payheroRes.ok) {
      console.error("PayHero rejected the request:", data);
      return res.status(502).json({ error: "PayHero rejected the request", details: data });
    }

    transactions.set(reference, { status: "PENDING", createdAt: Date.now() });
    res.json({ ok: true, payhero: data });
  } catch (err) {
    console.error("Failed to reach PayHero:", err);
    res.status(500).json({ error: "Failed to reach PayHero" });
  }
});

// PayHero posts the payment result here. Set this exact URL (yourdomain +
// /api/payhero-callback) as PUBLIC_CALLBACK_URL in your .env, and it's what
// gets sent to PayHero on every /api/stk-push request.
app.post("/api/payhero-callback", (req, res) => {
  const body = req.body || {};
  console.log("PayHero callback received:", JSON.stringify(body));

  // PayHero's callback payload can vary slightly — log a few real callbacks
  // during testing and adjust these field names if needed.
  const reference = body.external_reference || body.reference;
  const rawStatus = (body.status || body.ResultDesc || "").toString().toUpperCase();
  const success = rawStatus.includes("SUCCESS") || rawStatus === "COMPLETED";

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
