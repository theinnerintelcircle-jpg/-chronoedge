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
    // Get unalerted hot deals — priority alerts first, then biggest discount
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
      // Clean model name
      let modelName = deal.model || deal.reference_number || 'Unknown';
      if (modelName.length > 60) modelName = modelName.substring(0, 60) + '...';

      const saving = Math.round(deal.market_value - deal.price);
      const savingText = saving > 0 ? `💰 You save: *£${saving.toLocaleString()}*\n` : '';
      const priorityHeader = deal.is_priority_alert ? '🚨 *PRIORITY — DISCONTINUED MODEL*\n\n' : '';
      const discontinuedNote = deal.is_discontinued_model ? '⚡ _Discontinued reference — prices rising_\n' : '';
      const priceFormatted = Math.round(deal.price).toLocaleString();
      const marketFormatted = Math.round(deal.market_value).toLocaleString();
      const disc = Math.abs(deal.discount_pct);

      const message =
        `${priorityHeader}🔥 *HOT DEAL ALERT*\n\n` +
        `⌚ *${modelName}*\n` +
        `🏷️ Ref: ${deal.reference_number}\n\n` +
        `💵 Price: *£${priceFormatted}*\n` +
        `📊 Market Value: £${marketFormatted}\n` +
        `📉 Discount: *${disc}% below market*\n` +
        `${savingText}` +
        `${discontinuedNote}` +
        `📦 Condition: ${deal.condition || 'Pre-owned'}\n\n` +
        `👉 [View on eBay](${deal.listing_url})`;

      // Send Telegram message
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
        // Mark as alerted — with Prefer header to ensure update works
        await fetch(
          `${SUPABASE_URL}/rest/v1/listings?id=eq.${deal.id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              apikey: SUPABASE_SERVICE_KEY,
              Prefer: 'return=minimal'
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
