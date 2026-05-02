import React, { useEffect, useMemo, useState } from "react";
import { StoreItem, StorePaymentEvent, StoreState } from "./types";
import { SHOP_ITEMS, TECHSTORE_BACKEND_URL } from "./constants";
import { formatCurrency, submitPaymentCode } from "./utils";
import SixDigitPaymentInput from "./SixDigitPaymentInput";

const TechStore = () => {
  const [cart, setCart] = useState<StoreItem[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<StoreState>("shopping");
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("Payment submitted. Waiting for TrustPay confirmation...");

  const websocketUrl = useMemo(() => {
    if (!TECHSTORE_BACKEND_URL) return null;
    try {
      const url = new URL(TECHSTORE_BACKEND_URL);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }, []);

  const total = cart.reduce((s, i) => s + i.price, 0);
  useEffect(() => {
    if (!correlationId || !websocketUrl || status !== "pending") return;
    const ws = new WebSocket(websocketUrl);
    ws.onopen = () => ws.send(JSON.stringify({ correlationId }));
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string) as Partial<StorePaymentEvent>;
        const normalized = String(payload.status ?? "").toUpperCase();
        if (normalized === "CONFIRMED") {
          setStatusText(`Payment confirmed for ${formatCurrency(Number(payload.amount ?? total))} in ${payload.storeName}.`);
          setStatus("done");
          return;
        }
        if (normalized === "REJECTED" || normalized === "EXPIRED") {
          setStatusText(`Payment ${normalized.toLowerCase()} in TrustPay.`);
          setStatus("rejected");
        }
      } catch {
        setStatusText("Payment update received.");
      }
    };

    ws.onerror = () => setStatusText("Waiting for confirmation. You can refresh this page later.");
    return () => ws.close();
  }, [correlationId, status, total, websocketUrl]);

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const normalizedCode = code.replace(/\D/g, "");
    if (normalizedCode.length < 6) return setError("Enter a 6-digit code");
    if (cart.length === 0) return setError("Cart is empty");

    try {
      const result = await submitPaymentCode(normalizedCode, total, "Tech Store");
      if (!result.correlationId) throw new Error("Missing correlation id from Tech Store backend");
      setCorrelationId(result.correlationId);
      setStatus("pending");
      setStatusText("Payment submitted. Waiting for TrustPay confirmation...");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit code");
    }
  };

  const reset = () => { setCart([]); setCode(""); setError(""); setStatus("shopping"); setCorrelationId(null); setStatusText("Payment submitted. Waiting for TrustPay confirmation..."); };

  if (status === "pending") {
    return (
      <div className="shop-wrapper">
        <h1 className="shop-title">Tech Store</h1>
        <div className="payment-status-card payment-waiting">
          <div className="loading-spinner" />
          <h2>Payment submitted</h2>
          <p>{statusText}</p>
        </div>
      </div>
    );
  }

  if (status === "done" || status === "rejected") {
    return (
      <div className="shop-wrapper">
        <h1 className="shop-title">Tech Store</h1>
        <div className="payment-status-card payment-waiting">
          <h2>{status === "done" ? "Payment confirmed" : "Payment not completed"}</h2>
          <p>{statusText}</p>
          <button className="btn btn-primary" onClick={reset}>Go Back to Store</button>
        </div>
      </div>
    );
  }

  return (
    <div className="shop-wrapper">
      <h1 className="shop-title">Tech Store</h1>
      <div className="shop-layout">
        <div className="shop-items">
          {SHOP_ITEMS.map((item) => (
            <div key={item.id} className="shop-item-card">
              <div className="item-emoji">{item.emoji}</div>
              <h3>{item.name}</h3>
              <p className="price">{formatCurrency(item.price)}</p>
              <button onClick={() => setCart(prev => [...prev, item])}>+ Add</button>
            </div>
          ))}
        </div>

        <div className="shop-cart-sticky">
          <div className="shop-cart">
            <h2>Cart</h2>
            {cart.length === 0 ? <p className="empty-cart">Empty</p> : (
              cart.map((item, idx) => (
                <div key={idx} className="cart-item">
                  <span>{item.name}</span>
                  <span>{formatCurrency(item.price)}</span>
                  <button className="remove-btn" onClick={() => setCart(prev => prev.filter((_, i) => i !== idx))}>x</button>
                </div>
              ))
            )}

            <div className="cart-total">
              <span>Total</span>
              <strong>{formatCurrency(total)}</strong>
            </div>

            <form onSubmit={handlePay} className="pay-form">
              <label>TrustPay Code</label>
              <SixDigitPaymentInput code={code} setCode={setCode} />
              {error && <div className="error-box">{error}</div>}
              <button type="submit" className="pay-btn">Pay {formatCurrency(total)}</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TechStore;
