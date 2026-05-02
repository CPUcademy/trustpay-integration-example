import { TECHSTORE_BACKEND_URL } from "./constants";
import { ApiErrorResponse, SubmitCodeRequest, SubmitCodeResponse } from "./types";

export const formatCurrency = (amount: number, currency = "PLN"): string => `${amount.toFixed(2)} ${currency}`;

export const submitPaymentCode = async (code: string, amount: number, storeName: string): Promise<SubmitCodeResponse> => {
  const payload: SubmitCodeRequest = { code, amount, storeName };
  const res = await fetch(`${TECHSTORE_BACKEND_URL}/api/payments/submit-code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as ApiErrorResponse;
    throw new Error(err.message ?? "Failed to submit payment code");
  }
  return res.json().catch(() => ({} as SubmitCodeResponse));
};
