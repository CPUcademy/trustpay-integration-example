require('dotenv').config();

const cors = require("cors");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const http = require("http");
const { WebSocketServer, OPEN } = require("ws");

// #### Configuration ####
const log = {
  debug: () => {},
  warn: () => {},
  info: (...args) => console.log("[INFO]", ...args),
  error: (...args) => console.error("[ERROR]", ...args),
};

const TRUSTPAY_BACKEND_URL = "http://host.docker.internal:8002";
const ALLOWED_ORIGINS = "http://localhost:5174,http://localhost:5173,http://localhost:3000"
.split(",").map(origin => origin.trim()).filter(Boolean);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET_TRUSTPAY || null;
const FINAL_STATUSES = new Set(["CONFIRMED", "REJECTED", "EXPIRED"]);
const FINALIZED_PAYMENT_TTL_MS = 30 * 60 * 1000;
const FINALIZED_CLEANUP_INTERVAL_MS = 60 * 1000;

const finalizedPayments = new Map();
const wsClients = new Map();

// #### Utility functions ####
const normalizeStatus = (value) => String(value ?? "").toUpperCase();
const pickHeader = (value) => (Array.isArray(value) ? value[0] : value);

const generateSignature = (payload, secret) => {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  return crypto.createHmac("sha256", secret).update(serialized).digest("hex");
};

const verifySignature = (payload, signature, secret) => {
  const expectedSignature = generateSignature(payload, secret);
  const provided = Buffer.from(String(signature));
  const expected = Buffer.from(String(expectedSignature));
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
};

const createCorrelationId = () => {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  return `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getPublicBaseUrl = (req) => {
  const forwardedProto = pickHeader(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || req.protocol || "http";
  const host = req.get("host");
  return `${protocol}://${host}`;
};

const toFrontendEvent = (correlationId, body) => ({
  type: "PAYMENT_FINALIZED",
  source: "webhook",
  correlationId,
  status: normalizeStatus(body?.status),
  amount: body?.amount,
  storeName: body?.storeName,
  receivedAt: new Date().toISOString(),
});

// #### App setup ####
const app = express();
app.use(helmet());
app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

// Capture raw body before JSON parsing for webhook signature validation.
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    req.rawBody = buf.toString(encoding || "utf8");
  },
}));

// #### WebSocket setup (connection to TechStore frontend) ####
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    try {
      const { correlationId } = JSON.parse(raw.toString());
      if (!correlationId) return;

      const finalized = finalizedPayments.get(correlationId);
      if (finalized) {
        ws.send(JSON.stringify(finalized));
        return;
      }

      wsClients.set(correlationId, ws);
    } catch {
      // Ignore malformed client payloads.
    }
  });

  ws.on("close", () => {
    for (const [id, client] of wsClients.entries())
      if (client === ws) wsClients.delete(id);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, payload] of finalizedPayments.entries()) {
    const ts = Date.parse(payload.receivedAt ?? "");
    if (Number.isNaN(ts) || now - ts > FINALIZED_PAYMENT_TTL_MS)
      finalizedPayments.delete(id);
  }
}, FINALIZED_CLEANUP_INTERVAL_MS);

// #### Submit payment code (TrustPay) ####
app.post("/api/payments/submit-code", async (req, res) => {
  const { code, amount, storeName } = req.body ?? {};

  if (typeof code !== "string" || code.trim().length !== 6)
    return res.status(400).json({ message: "Enter a valid 6-digit code" });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
    return res.status(400).json({ message: "Enter a valid payment amount" });
  if (typeof storeName !== "string" || !storeName.trim())
    return res.status(400).json({ message: "Store name is required" });

  const correlationId = createCorrelationId();
  const webhookUrl = `${getPublicBaseUrl(req).replace(/\/+$/, "")}/webhook/${correlationId}`;

  try {
    const response = await fetch(`${TRUSTPAY_BACKEND_URL}/api/v1/payments/submit-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: code.trim(),
        amount,
        storeName: storeName.trim(),
        webhookUrl,
        webhookSecret: WEBHOOK_SECRET || undefined,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = typeof payload.message === "string" ? payload.message : "Failed to submit payment code";
      return res.status(response.status).json({ message });
    }

    return res.status(200).json({
      requestId: payload.requestId,
      correlationId,
    });
  } catch (err) {
    const cause = err.cause?.message ?? err.cause?.code ?? err.message ?? String(err);
    log.error(`[submit-code] fetch failed — ${cause} — target: ${TRUSTPAY_BACKEND_URL}`);
    return res.status(502).json({ message: "Tech Store backend could not reach TrustPay" });
  }
});

// #### Webhook receiver ####
app.post("/webhook/:correlationId", (req, res) => {
  const { correlationId } = req.params;
  const signature = pickHeader(req.headers["x-webhook-signature"]);
  const normalizedStatus = normalizeStatus(req.body?.status);

  log.info(`[webhook] Received POST /${correlationId}`);

  if (!WEBHOOK_SECRET) {
    log.error("[webhook] REJECTED: WEBHOOK_SECRET not configured");
    return res.status(503).json({ error: "Webhook verification is not configured" });
  }
  if (!signature) {
    log.error("[webhook] REJECTED: Missing signature");
    return res.status(401).json({ error: "Missing webhook signature" });
  }

  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    if (!verifySignature(rawBody, signature, WEBHOOK_SECRET)) {
      log.error("[webhook] REJECTED: Invalid signature");
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
    log.info("[webhook] Signature verified");
  } catch (err) {
    log.error(`[webhook] REJECTED: ${err.message}`);
    return res.status(401).json({ error: "Signature verification failed" });
  }

  if (!FINAL_STATUSES.has(normalizedStatus)) {
    log.debug(`[webhook] SKIPPED: Non-final status ${normalizedStatus}`);
    return res.sendStatus(202);
  }
  if (typeof req.body?.storeName !== "string" || !req.body.storeName.trim()) {
    log.error("[webhook] REJECTED: Missing storeName in terminal status payload");
    return res.status(400).json({ error: "storeName is required for terminal webhook events" });
  }

  log.info(`[webhook] Processing: status=${normalizedStatus}`);
  const payload = toFrontendEvent(correlationId, { ...req.body, storeName: req.body.storeName.trim() });
  finalizedPayments.set(correlationId, payload);

  const ws = wsClients.get(correlationId);
  if (ws && ws.readyState === OPEN) {
    log.debug("[webhook] Sent to WebSocket client");
    ws.send(JSON.stringify(payload));
    wsClients.delete(correlationId);
  } else
    log.debug(`[webhook] No active WebSocket client for ${correlationId} (will retry on reconnect)`);

  return res.sendStatus(200);
});

// #### Startup ####
server.listen(3000, () => log.info(`TechStore backend listening on :${3000}`));
