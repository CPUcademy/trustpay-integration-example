export type StoreItem = {
  id: number;
  name: string;
  price: number;
  emoji: string;
};

export type PaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "EXPIRED";
export type FinalPaymentStatus = Exclude<PaymentStatus, "PENDING">;

export type SubmitCodeRequest = {
  code: string;
  amount: number;
  storeName: string;
};

export type SubmitCodeResponse = {
  requestId?: number;
  correlationId?: string;
};

export type ApiErrorResponse = {
  message?: string;
  error?: string;
};

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
