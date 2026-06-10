import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

const WATCH_SEARCHES = [
  { brand: 'Rolex', queries: ['Rolex Submariner', 'Rolex Datejust', 'Rolex GMT Master', 'Rolex Daytona', 'Rolex Explorer'] },
  { brand: 'Omega', queries: ['Omega Speedmaster', 'Omega Seamaster', 'Omega Aqua Terra'] },
  { brand: 'Tudor', queries: ['Tudor Black Bay', 'Tudor Pelagos'] },
  { brand: 'Patek Philippe', queries: ['Patek Philippe Nautilus', 'Patek Philippe Calatrava'] },
  { brand: 'Audemars Piguet', queries: ['Audemars Piguet Royal Oak'] },
  { brand: 'Breitling', queries: ['Breitling Navitimer', 'Breitling Superocean'] },
  { brand: 'IWC', queries: ['IWC Portugieser', 'IWC Pilot'] },
  { brand: 'Tag Heuer', queries: ['Tag Heuer Carrera', 'Tag Heuer Monaco'] },
  { brand: 'Cartier', queries: ['Cartier Santos', 'Cartier Tank'] },
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
  'omega aqua terra': 4800,
  'tudor black bay': 3400,
  'tudor pelagos': 3800,
  'patek philippe nautilus': 115000,
  'patek philippe calatrava': 28000,
  'audemars piguet royal oak': 67000,
  'breitling navitimer': 6000,
  'breitling superocean': 3800,
  'iwc portugieser': 7800,
  'iwc pilot': 4500,
  'tag heuer carrera': 2800,
  'tag heuer monaco': 4200,
  'cartier santos': 6200,
  'cartier tank': 5800,
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
    limit: '50',
    sort: 'newlyListed',
    filter: 'buyingOptions:{FIXED_PRICE|AUCTION}',
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
  const titleLower = title.toLowerCase();
  for (const [key, value] of Object.entries(MARKET_VALUES)) {
    if (titleLower.includes(key)) return value;
  }
  return null;
}

function parseListing(item, brand) {
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

  const conditionMap = { 'NEW': 'Unworn', 'LIKE_NEW': 'Excellent', 'VERY_GOOD': 'Good', 'GOOD': 'Good', 'ACCEPTABLE': 'Fair' };

  return {
    source: 'ebay',
    external_id: item.itemId,
    listing_url: item.itemWebUrl,
    brand_name: brand,
    title: item.title,
    price: price,
    currency: currency,
    price_gbp: priceGbp,
    market_value: marketValue,
    discount_pct: discountPct,
    spread: spread,
    is_deal: isDeal,
    is_hot: isHot,
    condition: conditionMap[item.condition] || item.conditionDisplayName || 'Unknown',
    seller_name: item.seller?.username || null,
    seller_rating: item.seller?.feedbackPercentage ? parseFloat(item.seller.feedbackPercentage) : null,
    seller_type: (item.seller?.feedbackScore || 0) > 100 ? 'dealer' : 'private',
    listing_type: item.buyingOptions?.includes('FIXED_PRICE') ? 'Buy It Now' : 'Auction',
    location: item.itemLocation?.city || item.itemLocation?.stateOrProvince || null,
    country: item.itemLocation?.country || null,
    image_urls: item.thumbnailImages?.map(img => img.imageUrl) || (item.image?.imageUrl ? [item.image.imageUrl] : []),
    listed_at: item.itemCreationDate || null,
    is_active: true,
    alert_sent: false,
    last_seen_at: new Date().toISOString(),
  };
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
            const listing = parseListing(item, brandSearch.brand);
            const { error } = await supabase
              .from('listings')
              .upsert(listing, { onConflict: 'source,external_id' });
            if (!error) {
              totalSaved++;
              if (listing.is_deal) totalDeals++;
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
