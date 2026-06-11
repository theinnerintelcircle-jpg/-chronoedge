// ============================================================
// ChronoEdge Auth Token Validator
// GET /api/auth?token=xxx&email=xxx
// ============================================================

export default async function handler(req, res) {
  const { token, email } = req.query;

  if (!token || !email) {
    return res.status(400).json({ valid: false, error: 'Missing token or email' });
  }

  const normalEmail = decodeURIComponent(email).toLowerCase().trim();

  const subRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(normalEmail)}&select=*`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  const subscribers = await subRes.json();

  if (!subscribers || subscribers.length === 0) {
    return res.status(401).json({ valid: false, error: 'Invalid token' });
  }

  const subscriber = subscribers[0];

  if (subscriber.access_token !== token) {
    return res.status(401).json({ valid: false, error: 'Invalid token' });
  }

  if (new Date(subscriber.token_expires_at) < new Date()) {
    return res.status(401).json({ valid: false, error: 'Token expired' });
  }

  if (subscriber.status !== 'active') {
    return res.status(401).json({ valid: false, error: 'No active subscription' });
  }

  // Clear the token after use
  await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(normalEmail)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        access_token: null,
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  return res.status(200).json({
    valid: true,
    email: subscriber.email,
    plan: subscriber.plan,
  });
}
