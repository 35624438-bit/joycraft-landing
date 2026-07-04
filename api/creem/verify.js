/**
 * Vercel Serverless Function — Creem API Proxy
 *
 * POST /api/creem/verify
 * Body: { "subscriptionId": "sub_xxx" }
 *
 * Proxies subscription verification to Creem API.
 * Secret Key lives ONLY in Vercel environment variables,
 * never exposed in extension source code.
 *
 * Zero dependencies — uses Node.js 18+ built-in fetch.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Validate environment
  const SECRET_KEY = process.env.CREEM_SECRET_KEY;
  if (!SECRET_KEY) {
    return res.status(500).json({
      error: 'Server configuration error: CREEM_SECRET_KEY is not set.'
    });
  }

  // Parse request
  const { subscriptionId } = req.body || {};
  if (!subscriptionId || typeof subscriptionId !== 'string') {
    return res.status(400).json({
      error: 'Missing or invalid subscriptionId in request body.'
    });
  }

  // Call Creem API with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://api.creem.io/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        headers: {
          'Authorization': `Bearer ${SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timer);

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || `Creem API returned ${response.status}`
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Creem API request timed out.' });
    }
    return res.status(502).json({ error: 'Failed to reach Creem API.' });
  }
}
