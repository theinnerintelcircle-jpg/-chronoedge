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
    const dealsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?is_hot=eq.true&alert_sent=eq.false&is_active=eq.true&order=is_priority_alert.desc,discount_pct.asc&limit=5`,
      {
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          apikey: SUPABASE_SERVICE_KEY
        }
      }
    );

    const deals = await dealsRes.json();

    if (!deals || deals.length === 0) {
      return res.status(200).json({ success: true, message: 'No new deals to alert' });
    }

    let sent = 0;

    for (const deal of deals) {
      // Clean up model name — remove ref number from title if present
      let modelName = deal.model || deal.reference_number;
      // Capitalise first letter of each word for cleaner display
      modelName = modelName.length > 60 ? modelName.substring(0, 60) + '...' : modelName;

      const saving = deal.market_value - deal.price;
      const savingText = saving > 0 ? `💰 You save: *£${Math.round(saving).toLocaleString()}*\n` : '';
      const priorityHeader = deal.is_priority_alert ? '🚨 *PRIORITY ALERT — DISCONTINUED MODEL*\n\n' : '';
      const discontinuedNote = deal.is_discontinued_model ? '⚡ _Discontinued reference — prices rising_\n' : '';

      const message =
        `${priorityHeader}🔥 *HOT DEAL ALERT*\n\n` +
        `⌚ *${modelName}*\n` +
        `🏷️ Ref: ${deal.reference_number}\n\n` +
        `💵 Price: *£${Math.round(deal.price).toLocaleString()}*\n` +
        `📊 Market Value: £${Math.round(deal.market_value).toLocaleString()}\n` +
        `📉 Discount: *${Math.abs(deal.discount_pct)}% below market*\n` +
        `${savingText}` +
        `${discontinuedNote}` +
        `📦 Condition: ${deal.condition || 'Pre-owned'}\n\n` +
        `👉 [View on eBay](${deal.listing_url})`;

      const tgRes = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHANNEL,
            text: message,
            parse_mode: 'Markdown',
            disable_web_page_preview: false
          })
        }
      );

      if (tgRes.ok) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/listings?id=eq.${deal.id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              apikey: SUPABASE_SERVICE_KEY
            },
            body: JSON.stringify({ alert_sent: true })
          }
        );
        sent++;
      }
    }

    return res.status(200).json({ success: true, alertsSent: sent });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
