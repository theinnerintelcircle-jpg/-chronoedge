const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

const WATCH_SEARCHES = [
  { brand: 'Rolex', queries: ['Rolex Submariner', 'Rolex Datejust', 'Rolex GMT Master', 'Rolex Daytona'] },
  { brand: 'Omega', queries: ['Omega Speedmaster', 'Omega Seamaster'] },
  { brand: 'Tudor', queries: ['Tudor Black Bay'] },
  { brand: 'Patek Philippe', queries: ['Patek Philippe Nautilus'] },
  { brand: 'Audemars Piguet', queries: ['Audemars Piguet Royal Oak'] },
  { brand: 'Breitling', queries: ['Breitling Navitimer'] },
  { brand: 'IWC', queries: ['IWC Portugieser'] },
  { brand: 'Tag Heuer', queries: ['Tag Heuer Carrera'] },
  { brand: 'Cartier', queries: ['Cartier Santos'] },
  { brand: 'Grand Seiko', queries: ['Grand Seiko Spring Drive'] },
];

const MARKET_VALUES = {
  'rolex submariner': 9200,
  'rolex datejust': 6500,
  'rolex gmt master': 11000,
  'rolex daytona': 18500,
  'rolex explorer': 7200,
  'omega speedmaster': 5400,
  'omega seamaster': 4200,
  'tudor black bay': 3400,
  'patek philippe nautilus': 115000,
  'audemars piguet royal oak': 67000,
  'breitling navitimer': 6000,
  'iwc portugieser': 7800,
  'tag heuer carrera': 2800,
  'cartier santos': 6200,
  'grand seiko spring drive': 4600,
};

async function getEbayToken() {
  const credentials = Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  const data = await response.json();
  if (!data.access_token) throw new Error(`eBay auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function searchEbay(token, query) {
  const params = new URLSearchParams({
    q: query,
    category_ids: '31387',
    limit: '20',
    sort: 'newlyListed',
  });
  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
    },
  });
  const data = await response.json();
  return data.itemSummaries || [];
}

function getMarketValue(title) {
  const t = title.toLowerCase();
  for (const [key, value] of Object.entries(MARKET_VALUES)) {
    if (t.includes(key)) return value;
  }
  return null;
}

async function saveListing(listing) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/listings`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(listing),
  });
  return response.ok;
}

export default async function handler(req, res) {
  let totalSaved = 0;
  let totalDeals = 0;

  try {
    const token = await getEbayToken();

    for (const brandSearch of WATCH_SEARCHES) {
      for (const query of brandSearch.queries) {
        try {
          const items = await searchEbay(token, query);
          for (const item of items) {
            const price = parseFloat(item.price?.value || 0);
            const currency = item.price?.currency || 'GBP';
            let priceGbp = price;
            if (currency === 'USD') priceGbp = price * 0.79;
            if (currency === 'EUR') priceGbp = price * 0.85;

            const marketValue = getMarketValue(item.title || '');
            let discountPct = null;
            let spread = null;
            let isDeal = false;
            let isHot = false;

            if (marketValue && priceGbp > 0) {
              discountPct = Math.round(((marketValue - priceGbp) / marketValue) * 1000) / 10;
              spread = Math.round(marketValue - priceGbp);
              isDeal = discountPct >= 8;
              isHot = discountPct >= 15;
            }

            const listing = {
              source: 'ebay',
              external_id: item.itemId,
              listing_url: item.itemWebUrl,
              brand_name: brandSearch.brand,
              title: item.title,
              price: price,
              currency: currency,
              price_gbp: priceGbp,
              market_value: marketValue,
              discount_pct: discountPct,
              spread: spread,
              is_deal: isDeal,
              is_hot: isHot,
              condition: item.conditionDisplayName || 'Unknown',
              seller_name: item.seller?.username || null,
              seller_rating: item.seller?.feedbackPercentage ? parseFloat(item.seller.feedbackPercentage) : null,
              listing_type: item.buyingOptions?.includes('FIXED_PRICE') ? 'Buy It Now' : 'Auction',
              location: item.itemLocation?.city || null,
              country: item.itemLocation?.country || null,
              is_active: true,
              alert_sent: false,
            };

            const saved = await saveListing(listing);
            if (saved) {
              totalSaved++;
              if (isDeal) totalDeals++;
            }
          }
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          console.error(`Error: ${query}:`, err.message);
        }
      }
    }

    return res.status(200).json({ success: true, totalSaved, totalDeals });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
