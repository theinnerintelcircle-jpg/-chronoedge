export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
  const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  const marketValues = {
    'Rolex Submariner': 8500,
    'Rolex Datejust': 5500,
    'Omega Seamaster': 2800,
    'Omega Speedmaster': 3200,
    'TAG Heuer Carrera': 2200,
    'Breitling Navitimer': 3500,
    'IWC Portugieser': 4500,
    'Panerai Luminor': 4000,
    'Tudor Black Bay': 2600,
    'Cartier Santos': 4200
  };

  try {
    // Step 1: Get eBay token
    const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(EBAY_CLIENT_ID + ':' + EBAY_CLIENT_SECRET)
      },
      body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.status(500).json({ error: 'Failed to get eBay token', details: tokenData });
    }

    let totalSaved = 0;
    let totalDeals = 0;
    const allListings = [];

    // Step 2: Search eBay for each watch brand
    for (const [watchName, marketValue] of Object.entries(marketValues)) {
      const searchRes = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(watchName)}&category_ids=31387&marketplace_id=EBAY_GB&limit=20`,
        {
          headers: {
            'Authorization': 'Bearer ' + accessToken,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB'
          }
        }
      );

      const searchData = await searchRes.json();
      const items = searchData.itemSummaries || [];

      for (const item of items) {
        const price = parseFloat(item.price?.value || 0);
        if (price <= 0) continue;

        const discount = ((marketValue - price) / marketValue) * 100;
        const isDeal = discount >= 8;
        const isHotDeal = discount >= 15;

        const listing = {
          external_id: item.itemId,
          source: 'ebay_gb',
          title: item.title,
          brand: watchName.split(' ')[0],
          model: watchName,
          price: price,
          currency: item.price?.currency || 'GBP',
          market_value: marketValue,
          discount_percent: Math.round(discount * 10) / 10,
          is_deal: isDeal,
          is_hot_deal: isHotDeal,
          url: item.itemWebUrl,
          image_url: item.image?.imageUrl || null,
          condition: item.condition || 'Unknown',
          location: item.itemLocation?.country || 'GB',
          scraped_at: new Date().toISOString()
        };

        allListings.push(listing);
        if (isDeal) totalDeals++;
      }
    }

    // Step 3: Save to Supabase
    if (allListings.length > 0) {
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
          'apikey': SUPABASE_SERVICE_KEY,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(allListings)
      });

      if (upsertRes.ok) {
        totalSaved = allListings.length;
      } else {
        const errText = await upsertRes.text();
        return res.status(500).json({ error: 'Supabase upsert failed', details: errText });
      }
    }

    return res.status(200).json({
      success: true,
      totalSaved,
      totalDeals,
      message: `Saved ${totalSaved} listings, found ${totalDeals} deals`
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
