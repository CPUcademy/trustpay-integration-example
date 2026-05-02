# TrustPay Integration

This example store shows how to integrate with TrustPay payments.

## 1. Store -> TrustPay backend

Endpoint:
- `POST /api/payments/submit-code`

Required request JSON fields:
- `code` (string, 6 digits)
- `amount` (number > 0)
- `storeName` (non-empty string)
- `webhookUrl` (`https://<store-host>/webhook/:correlationId`)
- `webhookSecret` (provided by TrustPay admin and saved as `WEBHOOK_SECRET_TRUSTPAY` environment variable)

Store backend behavior:
- Returns `200` with `{ requestId, correlationId }` on success
- Forwards TrustPay error status/message on failure

## 2. TrustPay backend -> Store webhook

Endpoint:
- `POST /webhook/:correlationId` (Store backend)

Expected terminal webhook body:
- `status`: `CONFIRMED` | `REJECTED` | `EXPIRED`
- `amount`
- `storeName` (required, non-empty for terminal statuses)

On valid terminal webhook, TechStore emits WebSocket event:
- `type: "PAYMENT_FINALIZED"`
- `source: "webhook"`
- `correlationId`, `status`, `amount`, `storeName`, `receivedAt`