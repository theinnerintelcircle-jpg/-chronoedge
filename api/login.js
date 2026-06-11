// ============================================================
// ChronoEdge Magic Link Login
// POST /api/login — sends magic link to subscriber email
// ============================================================

import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const normalEmail = email.toLowerCase().trim();

  // Check if subscriber exists and is active
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
    return res.status(200).json({ success: true, message: 'If that email has an active subscription, a login link has been sent.' });
  }

  const subscriber = subscribers[0];

  if (subscriber.status !== 'active') {
    return res.status(200).json({ success: true, message: 'If that email has an active subscription, a login link has been sent.' });
  }

  // Generate magic link token
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes

  // Save token to Supabase
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
        access_token: token,
        token_expires_at: expires,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  // Send magic link email via Gmail SMTP would need nodemailer
  // For now use a simple fetch to a mail service
  // We'll use the magic link URL directly
  const magicLink = `https://www.chronoedge.net/dashboard.html?token=${token}&email=${encodeURIComponent(normalEmail)}`;

  // Send via Mailgun or similar — for now log it
  console.log(`Magic link for ${normalEmail}: ${magicLink}`);

  // Send email via Gmail using fetch to a simple SMTP relay
  // Using Resend API (free tier 100 emails/day)
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'ChronoEdge <hello@chronoedge.net>',
        to: normalEmail,
        subject: 'Your ChronoEdge login link',
        html: `
          <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #111;">
            <h1 style="font-size: 28px; margin-bottom: 8px; letter-spacing: -0.5px;">CHRONO<span style="color: #C9A84C;">EDGE</span></h1>
            <p style="font-size: 13px; color: #999; margin-bottom: 40px; letter-spacing: 2px; text-transform: uppercase;">Watch Deal Intelligence</p>
            <p style="font-size: 17px; margin-bottom: 24px; line-height: 1.7;">Click the button below to log in to your ChronoEdge dashboard. This link expires in 30 minutes.</p>
            <a href="${magicLink}" style="display: inline-block; background: #C9A84C; color: #fff; padding: 16px 36px; font-size: 14px; font-weight: 700; text-decoration: none; margin-bottom: 32px;">Access Dashboard →</a>
            <p style="font-size: 13px; color: #999; line-height: 1.7;">If you didn't request this link, you can safely ignore this email. Your account remains secure.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
            <p style="font-size: 12px; color: #bbb;">ChronoEdge · London, UK · <a href="https://www.chronoedge.net" style="color: #C9A84C;">chronoedge.net</a></p>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Email send error:', err);
  }

  return res.status(200).json({ success: true, message: 'If that email has an active subscription, a login link has been sent.' });
}
