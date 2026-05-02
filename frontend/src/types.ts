export type StoreItem = {
  id: number;
  name: string;
  price: number;
  emoji: string;
};

export type PaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "EXPIRED";
export type FinalPaymentStatus = Exclude<PaymentStatus, "PENDING">;

// TechStore frontend -> TechStore backend (/api/payments/submit-code)
export type SubmitCodeRequest = {
  code: string;
  amount: number;
  storeName: string;
};

// TechStore backend -> TechStore frontend response
export type SubmitCodeResponse = {
  requestId?: number;
  correlationId?: string;
};

export type ApiErrorResponse = {
  message?: string;
  error?: string;
};

// TrustPay webhook status forwarded by TechStore backend to frontend via WebSocket
export type StorePaymentEvent = {
  type: "PAYMENT_FINALIZED";
  source: "webhook";
  correlationId: string;
  status: FinalPaymentStatus;
  amount: number;
  storeName: string;
  receivedAt: string;
};

export type StoreState = "shopping" | "pending" | "done" | "rejected";
