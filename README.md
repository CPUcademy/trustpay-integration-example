# TrustPay Integration

This example store shows how to integrate with TrustPay payments.

## 1. Store backend -> TrustPay backend

Endpoint:
- `POST /api/payments/submit-code`

Required request JSON fields:
- `code` (string, 6 digits)
- `amount` (number > 0)
- `storeName` (non-empty string)
- `webhookUrl` (`https://<store-host>/webhook/:correlationId`)
- `webhookSecret` (provided by TrustPay admin and saved as `WEBHOOK_SECRET_TRUSTPAY` environment variable)

## 2. TrustPay backend -> Store webhook

**Important note:** If your website is running on localhost and is not exposed to a public URL, the webhook will not be delivered successfully because the TrustPay backend operates on a different network and cannot access your local environment.

Endpoint:
- `POST /webhook/:correlationId` (Store backend)

Expected webhook body:
- `status`: `CONFIRMED` | `REJECTED` | `EXPIRED`
- `amount`
- `storeName`

When a webhook is successfully received and validated, Store backend emits a WebSocket event to Store frontend:
- `type: "PAYMENT_FINALIZED"`
- `source: "webhook"`
- `correlationId`, `status`, `amount`, `storeName`, `receivedAt`
