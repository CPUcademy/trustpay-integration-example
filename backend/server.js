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

const TRUSTPAY_BACKEND_URL = "https://trustpay-backend-1orv.onrender.com";
const STORE_NAME = "TechStore";
const ALLOWED_ORIGINS = [
  "https://trustpay-integration-example.vercel.app"
];
const FINAL_STATUSES = new Set(["CONFIRMED", "REJECTED", "EXPIRED"]);
const FINALIZED_PAYMENT_TTL_MS = 30 * 60 * 1000;
const FINALIZED_CLEANUP_INTERVAL_MS = 60 * 1000;
const PENDING_PAYMENT_TTL_MS = 10 * 60 * 1000; // TrustPay codes live 3 minutes, so pending payments resolve well before this

const finalizedPayments = new Map();
const wsClients = new Map();
const submittedPayments = new Map(); // track submitted payments to prevent duplicates
const pendingPayments = new Map(); // correlationId -> { webhookSecret, requestId, amount, createdAt }

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

const toCents = (value) => Math.round(Number(value) * 100);

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
  requestId: body?.requestId,
  status: normalizeStatus(body?.status),
  amount: body?.amount,
  storeName: body?.storeName,
  receivedAt: new Date().toISOString(),
});

// #### App setup ####
const app = express();
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }

    log.warn(`[CORS] Request from disallowed origin: ${origin}`);
    return callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
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
  // Clean up old payment submission attempts (older than 10 seconds)
  for (const [key, ts] of submittedPayments.entries()) {
    if (now - ts > 10000)
      submittedPayments.delete(key);
  }
  for (const [id, pending] of pendingPayments.entries()) {
    if (now - pending.createdAt > PENDING_PAYMENT_TTL_MS)
      pendingPayments.delete(id);
  }
}, FINALIZED_CLEANUP_INTERVAL_MS);

// #### Submit payment code (TrustPay) ####
app.post("/api/payments/submit-code", async (req, res) => {
  const { code, amount } = req.body ?? {};
  const normalizedCode = typeof code === "string" ? code.replace(/\D/g, "").trim() : "";

  if (!/^\d{6}$/.test(normalizedCode))
    return res.status(400).json({ message: "Enter a valid 6-digit code" });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)
    return res.status(400).json({ message: "Enter a valid payment amount" });
  // Check for duplicate payment attempt (same code + amount + store within 5 seconds)
  const paymentKey = `${normalizedCode}|${amount}|${STORE_NAME}`;
  const lastAttempt = submittedPayments.get(paymentKey);
  if (lastAttempt && Date.now() - lastAttempt < 5000) {
    log.warn(`[submit-code] Duplicate payment attempt blocked: ${paymentKey}`);
    return res.status(429).json({ message: "Payment already submitted. Please wait before retrying." });
  }
  submittedPayments.set(paymentKey, Date.now());

  const correlationId = createCorrelationId();
  const webhookUrl = `${getPublicBaseUrl(req).replace(/\/+$/, "")}/webhook/${correlationId}`;
  // TrustPay signs the webhook for this payment with this secret (HMAC-SHA256), so a fresh one per payment
  // means a captured webhook can't be replayed against another order.
  const webhookSecret = crypto.randomBytes(32).toString("hex");
  pendingPayments.set(correlationId, { webhookSecret, requestId: null, amount, createdAt: Date.now() });

  try {
    const response = await fetch(`${TRUSTPAY_BACKEND_URL}/api/v1/payments/submit-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: normalizedCode,
        amount,
        storeName: STORE_NAME,
        webhookUrl,
        webhookSecret,
      }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      pendingPayments.delete(correlationId);
      const message = typeof payload.message === "string" ? payload.message : "Failed to submit payment code";
      return res.status(response.status).json({ message });
    }

    const pending = pendingPayments.get(correlationId);
    if (pending) pending.requestId = payload.requestId;

    return res.status(200).json({
      requestId: payload.requestId,
      correlationId,
    });
  } catch (err) {
    pendingPayments.delete(correlationId);
    const cause = err.cause?.message ?? err.cause?.code ?? err.message ?? String(err);
    log.error(`[submit-code] fetch failed — ${cause} — target: ${TRUSTPAY_BACKEND_URL}`);
    return res.status(502).json({ message: "Tech Store backend could not reach TrustPay" });
  }
});

app.get("/health", (req, res) => {
  return res.status(200).json({ status: "OK" });
});

// #### Webhook receiver ####
app.post("/webhook/:correlationId", (req, res) => {
  const { correlationId } = req.params;
  const signature = pickHeader(req.headers["x-webhook-signature"]);
  const normalizedStatus = normalizeStatus(req.body?.status);

  log.info(`[webhook] Received POST /${correlationId}`);

  const pending = pendingPayments.get(correlationId);
  if (!pending) {
    if (finalizedPayments.has(correlationId)) return res.sendStatus(200); // already processed
    log.error("[webhook] REJECTED: Unknown or expired correlationId");
    return res.status(404).json({ error: "Unknown payment" });
  }
  if (!signature) {
    log.error("[webhook] REJECTED: Missing signature");
    return res.status(401).json({ error: "Missing webhook signature" });
  }

  try {
    // Must be the exact bytes TrustPay signed, not a re-serialized req.body.
    if (!req.rawBody || !verifySignature(req.rawBody, signature, pending.webhookSecret)) {
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
  if (pending.requestId == null || req.body?.requestId !== pending.requestId) {
    log.error("[webhook] REJECTED: requestId does not match this payment");
    return res.status(400).json({ error: "requestId mismatch" });
  }
  if (toCents(req.body?.amount) !== toCents(pending.amount)) {
    log.error("[webhook] REJECTED: amount does not match this payment");
    return res.status(400).json({ error: "amount mismatch" });
  }
  if (typeof req.body?.storeName !== "string" || req.body.storeName.trim() !== STORE_NAME) {
    log.error("[webhook] REJECTED: storeName does not match this store");
    return res.status(400).json({ error: "storeName mismatch" });
  }

  log.info(`[webhook] Processing: status=${normalizedStatus}`);
  const payload = toFrontendEvent(correlationId, { ...req.body, storeName: req.body.storeName.trim() });
  finalizedPayments.set(correlationId, payload);
  pendingPayments.delete(correlationId);

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
