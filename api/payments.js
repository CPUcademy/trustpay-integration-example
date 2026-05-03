export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, amount, storeName } = req.body;

  if (!code || !amount || !storeName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Get the protocol and host from the request
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const correlationId = `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const webhookUrl = `${protocol}://${host}/api/webhook/${correlationId}`;
    const webhookSecret = process.env.WEBHOOK_SECRET_TRUSTPAY || '';

    const response = await fetch('https://trustpay-backend-1orv.onrender.com/api/payments/submit-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        code, 
        amount, 
        storeName, 
        webhookUrl,
        webhookSecret 
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Payment submission error:', error);
    return res.status(500).json({ error: 'Payment submission failed' });
  }
}
