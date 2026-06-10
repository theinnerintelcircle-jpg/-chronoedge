export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHANNEL = process.env.TELEGRAM_CHANNEL_ID;

  try {
    // Get unalerted hot deals
    const dealsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?is_hot=eq.true&alert_sent=eq.false&is_active=eq.true&limit=5`,
      {
        headers: {
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'apikey': SUPABASE_SERVICE_KEY
        }
      }
    );

    const deals = await dealsRes.json();

    if (!deals || deals.length === 0) {
      return res.status(200).json({ success: true, message: 'No new deals to alert' });
    }

    let sent = 0;

    for (const deal of deals) {
      const message = `🔥 *HOT DEAL ALERT*\n\n` +
        `⌚ *${deal.model}*\n` +
        `💰 Price: £${deal.price}\n` +
        `📊 Market Value: £${deal.market_value}\n` +
        `📉 Discount: ${deal.discount_pct}% below market\n` +
        `🏷️ Condition: ${deal.condition}\n\n` +
        `👉 [View on eBay](${deal.listing_url})`;

      // Send to Telegram channel
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHANNEL,
          text: message,
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        })
      });

      // Mark as alerted in Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/listings?id=eq.${deal.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'apikey': SUPABASE_SERVICE_KEY
        },
        body: JSON.stringify({ alert_sent: true })
      });

      sent++;
    }

    return res.status(200).json({ success: true, alertsSent: sent });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
