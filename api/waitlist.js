export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    const res2 = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'apikey': SUPABASE_SERVICE_KEY,
        'Prefer': 'resolution=ignore-duplicates'
      },
      body: JSON.stringify({
        email: email,
        plan: 'waitlist',
        created_at: new Date().toISOString()
      })
    });

    if (res2.ok) {
      return res.status(200).json({ success: true });
    } else {
      const err = await res2.text();
      return res.status(500).json({ error: 'Failed to save', details: err });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
