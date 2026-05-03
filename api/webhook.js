export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { correlationId } = req.query;

  if (!correlationId) {
    return res.status(400).json({ error: 'Missing correlationId' });
  }

  const body = req.body;
  const { status, amount, storeName } = body;

  // Validate webhook
  if (!status || !amount || !storeName) {
    return res.status(400).json({ error: 'Missing required webhook fields' });
  }

  console.log(`[Webhook] Received: ${correlationId} - Status: ${status}`);

  // TODO: In a real implementation, you would:
  // 1. Verify the webhook signature with WEBHOOK_SECRET_TRUSTPAY
  // 2. Store the payment status
  // 3. Emit a WebSocket event to notify the frontend
  // 4. Return 200 to acknowledge receipt

  return res.status(200).json({ 
    success: true, 
    message: 'Webhook received',
    correlationId,
    status
  });
}
