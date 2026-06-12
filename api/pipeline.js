// ============================================================
// ChronoEdge Pipeline — Updated June 2026
// Real market values from eBay sold listings
// Silent fake/suspicious listing filter
// Deal threshold: 12%+ below market
// Hot deal threshold: 15%+ below market
// ============================================================

export default async function handler(req, res) {
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    const token = await getEbayToken();
    await updateMarketValues(token);
    const marketValues = await getMarketValues();
    const allListings = await scrapeAllWatches(token, marketValues);
    const { saved, deals, supabaseError } = await saveToSupabase(allListings);
    await fetch(`https://www.chronoedge.net/api/notify?secret=${process.env.CRON_SECRET}`);

    return res.status(200).json({
      success: true,
      totalSaved: saved,
      totalDeals: deals,
      totalFound: allListings.length,
      firstItem: allListings[0] || null,
      supabaseError: supabaseError || null,
      message: `Saved ${saved} listings, found ${deals} deals`
    });
  } catch (err) {
    console.error('Pipeline error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ============================================================
// EBAY AUTH
// ============================================================

async function getEbayToken() {
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString('base64');

  const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });

  const data = await response.json();
  if (!data.access_token) throw new Error('Failed to get eBay token');
  return data.access_token;
}

// ============================================================
// FALLBACK VALUES — hotThreshold = 15% below market value
// isDeal = 12%+ below market, isHot = price <= hotThreshold
// ============================================================

const FALLBACK_VALUES = {
  '126710BLRO':       { name: 'Rolex GMT Pepsi',              value: 20000, discontinued: true,  hotThreshold: 17000 },
  '126710BLNR':       { name: 'Rolex GMT Batman/Batgirl',     value: 15500, discontinued: false, hotThreshold: 13175 },
  '126711CHNR':       { name: 'Rolex GMT Root Beer',          value: 18500, discontinued: false, hotThreshold: 15725 },
  '126715CHNR':       { name: 'Rolex GMT Root Beer Everose',  value: 28000, discontinued: false, hotThreshold: 23800 },
  '126610LN':         { name: 'Rolex Submariner Black Date',  value: 12000, discontinued: false, hotThreshold: 10200 },
  '126610LV':         { name: 'Rolex Submariner Starbucks',   value: 13000, discontinued: false, hotThreshold: 11050 },
  '124060':           { name: 'Rolex Submariner No Date',     value: 10500, discontinued: false, hotThreshold: 8925  },
  '126613LB':         { name: 'Rolex Submariner Bluesy',      value: 16000, discontinued: false, hotThreshold: 13600 },
  '126613LN':         { name: 'Rolex Submariner Two-Tone',    value: 15000, discontinued: false, hotThreshold: 12750 },
  '126500LN-panda':   { name: 'Rolex Daytona Panda',          value: 20000, discontinued: false, hotThreshold: 17000 },
  '126500LN-black':   { name: 'Rolex Daytona Black',          value: 18500, discontinued: false, hotThreshold: 15725 },
  '116500LN':         { name: 'Rolex Daytona 116500LN',       value: 19000, discontinued: false, hotThreshold: 16150 },
  '126515LN':         { name: 'Rolex Daytona Everose',        value: 32000, discontinued: false, hotThreshold: 27200 },
  '126519LN':         { name: 'Rolex Daytona White Gold',     value: 45000, discontinued: false, hotThreshold: 38250 },
  '126508':           { name: 'Rolex Daytona Yellow Gold',    value: 55000, discontinued: false, hotThreshold: 46750 },
  '126509':           { name: 'Rolex Daytona White Gold',     value: 52000, discontinued: false, hotThreshold: 44200 },
  '228238':           { name: 'Rolex Day-Date 40 Yellow Gold',       value: 38000, discontinued: false, hotThreshold: 32300 },
  '228235-olive':     { name: 'Rolex Day-Date 40 Olive Everose',     value: 33000, discontinued: false, hotThreshold: 28050 },
  '228235-chocolate': { name: 'Rolex Day-Date 40 Chocolate Everose', value: 30000, discontinued: false, hotThreshold: 25500 },
  '228235-green':     { name: 'Rolex Day-Date 40 Green Everose',     value: 29000, discontinued: false, hotThreshold: 24650 },
  '228206':           { name: 'Rolex Day-Date 40 Ice Blue Platinum', value: 72000, discontinued: false, hotThreshold: 61200 },
  '126334-mint':      { name: 'Rolex Datejust 41 Mint Green',   value: 11000, discontinued: false, hotThreshold: 9350  },
  '126334-blue':      { name: 'Rolex Datejust 41 Blue',         value: 10500, discontinued: false, hotThreshold: 8925  },
  '126334-wimbledon': { name: 'Rolex Datejust 41 Wimbledon',    value: 13000, discontinued: false, hotThreshold: 11050 },
  '126334-black':     { name: 'Rolex Datejust 41 Black',        value: 10000, discontinued: false, hotThreshold: 8500  },
  '126300':           { name: 'Rolex Datejust 41 Steel',        value: 9000,  discontinued: false, hotThreshold: 7650  },
  '126234-mint':      { name: 'Rolex Datejust 36 Mint Green',   value: 10000, discontinued: false, hotThreshold: 8500  },
  '126234-blue':      { name: 'Rolex Datejust 36 Blue',         value: 9500,  discontinued: false, hotThreshold: 8075  },
  '126234-wimbledon': { name: 'Rolex Datejust 36 Wimbledon',    value: 11500, discontinued: false, hotThreshold: 9775  },
  '126200':           { name: 'Rolex Datejust 36 Steel',        value: 8500,  discontinued: false, hotThreshold: 7225  },
  '336934-blue':      { name: 'Rolex Sky-Dweller Blue',         value: 20000, discontinued: false, hotThreshold: 17000 },
  '336934-green':     { name: 'Rolex Sky-Dweller Green',        value: 19000, discontinued: false, hotThreshold: 16150 },
  '5711/1A':          { name: 'Patek Nautilus 5711',            value: 90000, discontinued: true,  hotThreshold: 76500 },
  '5811/1G':          { name: 'Patek Nautilus 5811',            value: 95000, discontinued: false, hotThreshold: 80750 },
  '5167A':            { name: 'Patek Aquanaut 5167A',           value: 38000, discontinued: false, hotThreshold: 32300 },
  '5164A':            { name: 'Patek Aquanaut Travel Time',     value: 52000, discontinued: false, hotThreshold: 44200 },
  '15500ST':          { name: 'AP Royal Oak 15500ST',           value: 38000, discontinued: false, hotThreshold: 32300 },
  '16202ST':          { name: 'AP Royal Oak 16202ST',           value: 62000, discontinued: false, hotThreshold: 52700 },
  '26240ST':          { name: 'AP Royal Oak Chronograph',       value: 48000, discontinued: false, hotThreshold: 40800 },
  'RM 011':           { name: 'Richard Mille RM 011',           value: 120000, discontinued: false, hotThreshold: 102000 },
  'RM 035':           { name: 'Richard Mille RM 035',           value: 95000,  discontinued: false, hotThreshold: 80750  },
  'RM 055':           { name: 'Richard Mille RM 055',           value: 90000,  discontinued: false, hotThreshold: 76500  },
  'RM 65-01':         { name: 'Richard Mille RM 65-01',         value: 180000, discontinued: false, hotThreshold: 153000 },
  'WSSA0029':         { name: 'Cartier Santos Medium',          value: 7500,  discontinued: false, hotThreshold: 6375 },
  'WSSA0018':         { name: 'Cartier Santos Large',           value: 8200,  discontinued: false, hotThreshold: 6970 },
};

// ============================================================
// SEARCH QUERIES
// ============================================================

const SEARCH_QUERIES = [
  { query: '126710BLRO',              brand: 'Rolex', refKey: '126710BLRO',       priority: 'HIGH'   },
  { query: '126710BLNR',              brand: 'Rolex', refKey: '126710BLNR',       priority: 'NORMAL' },
  { query: '126711CHNR',              brand: 'Rolex', refKey: '126711CHNR',       priority: 'NORMAL' },
  { query: '126715CHNR',              brand: 'Rolex', refKey: '126715CHNR',       priority: 'NORMAL' },
  { query: '126610LN',                brand: 'Rolex', refKey: '126610LN',         priority: 'NORMAL' },
  { query: '126610LV',                brand: 'Rolex', refKey: '126610LV',         priority: 'NORMAL' },
  { query: '124060',                  brand: 'Rolex', refKey: '124060',           priority: 'NORMAL' },
  { query: '126613LB',                brand: 'Rolex', refKey: '126613LB',         priority: 'NORMAL' },
  { query: '126613LN',                brand: 'Rolex', refKey: '126613LN',         priority: 'NORMAL' },
  { query: '126500LN white panda',    brand: 'Rolex', refKey: '126500LN-panda',   priority: 'NORMAL' },
  { query: '126500LN black dial',     brand: 'Rolex', refKey: '126500LN-black',   priority: 'NORMAL' },
  { query: '116500LN',                brand: 'Rolex', refKey: '116500LN',         priority: 'NORMAL' },
  { query: '126515LN',                brand: 'Rolex', refKey: '126515LN',         priority: 'NORMAL' },
  { query: '126519LN',                brand: 'Rolex', refKey: '126519LN',         priority: 'NORMAL' },
  { query: '126508',                  brand: 'Rolex', refKey: '126508',           priority: 'NORMAL' },
  { query: '126509',                  brand: 'Rolex', refKey: '126509',           priority: 'NORMAL' },
  { query: '228235 olive green',      brand: 'Rolex', refKey: '228235-olive',     priority: 'NORMAL' },
  { query: '228235 chocolate',        brand: 'Rolex', refKey: '228235-chocolate', priority: 'NORMAL' },
  { query: '228235 green',            brand: 'Rolex', refKey: '228235-green',     priority: 'NORMAL' },
  { query: '228238',                  brand: 'Rolex', refKey: '228238',           priority: 'NORMAL' },
  { query: '228206',                  brand: 'Rolex', refKey: '228206',           priority: 'NORMAL' },
  { query: '126334 mint green',       brand: 'Rolex', refKey: '126334-mint',      priority: 'NORMAL' },
  { query: '126334 blue',             brand: 'Rolex', refKey: '126334-blue',      priority: 'NORMAL' },
  { query: '126334 wimbledon',        brand: 'Rolex', refKey: '126334-wimbledon', priority: 'NORMAL' },
  { query: '126334 black',            brand: 'Rolex', refKey: '126334-black',     priority: 'NORMAL' },
  { query: '126300',                  brand: 'Rolex', refKey: '126300',           priority: 'NORMAL' },
  { query: '126234 mint green',       brand: 'Rolex', refKey: '126234-mint',      priority: 'NORMAL' },
  { query: '126234 wimbledon',        brand: 'Rolex', refKey: '126234-wimbledon', priority: 'NORMAL' },
  { query: '126234 blue',             brand: 'Rolex', refKey: '126234-blue',      priority: 'NORMAL' },
  { query: '126200',                  brand: 'Rolex', refKey: '126200',           priority: 'NORMAL' },
  { query: '336934 blue',             brand: 'Rolex', refKey: '336934-blue',      priority: 'NORMAL' },
  { query: '336934 green',            brand: 'Rolex', refKey: '336934-green',     priority: 'NORMAL' },
  { query: '5711/1A',                 brand: 'Patek Philippe', refKey: '5711/1A', priority: 'HIGH'   },
  { query: '5811/1G',                 brand: 'Patek Philippe', refKey: '5811/1G', priority: 'HIGH'   },
  { query: '5167A',                   brand: 'Patek Philippe', refKey: '5167A',   priority: 'NORMAL' },
  { query: '5164A',                   brand: 'Patek Philippe', refKey: '5164A',   priority: 'NORMAL' },
  { query: '15500ST',                 brand: 'Audemars Piguet', refKey: '15500ST', priority: 'NORMAL' },
  { query: '16202ST',                 brand: 'Audemars Piguet', refKey: '16202ST', priority: 'HIGH'   },
  { query: '26240ST',                 brand: 'Audemars Piguet', refKey: '26240ST', priority: 'NORMAL' },
  { query: 'Richard Mille RM 011',    brand: 'Richard Mille', refKey: 'RM 011',   priority: 'NORMAL' },
  { query: 'Richard Mille RM 035',    brand: 'Richard Mille', refKey: 'RM 035',   priority: 'NORMAL' },
  { query: 'Richard Mille RM 055',    brand: 'Richard Mille', refKey: 'RM 055',   priority: 'NORMAL' },
  { query: 'Richard Mille RM 65-01',  brand: 'Richard Mille', refKey: 'RM 65-01', priority: 'NORMAL' },
  { query: 'WSSA0029',                brand: 'Cartier', refKey: 'WSSA0029', priority: 'NORMAL' },
  { query: 'WSSA0018',                brand: 'Cartier', refKey: 'WSSA0018', priority: 'NORMAL' },
];

// ============================================================
// FAKE / SUSPICIOUS LISTING FILTER
// ============================================================

function isSuspicious(item, price, marketValue) {
  const title = (item.title || '').toLowerCase();
  if (marketValue > 0 && price < marketValue * 0.60) return true;
  if (price < 1500) return true;
  const fakeKeywords = ['inspired', 'homage', 'rep ', 'replica', 'grade', 'aaa', 'clone', 'copy', 'fake', 'imitation', 'lookalike', 'dial only', 'dial sealed', 'dial blister', 'pikachu', 'parts only', 'for parts', 'spares', 'movement only', 'case only', 'no watch', 'vvs', 'lab diamond', 'natural diamond', 'diamond bezel', 'diamond dial', 'iced out', 'custom diamond'];
  if (fakeKeywords.some(kw => title.includes(kw))) return true;
  const misspellings = ['roiex', 'rollex', 'pattek', 'audemar ', 'richrd mille'];
  if (misspellings.some(kw => title.includes(kw))) return true;
  return false;
}

// ============================================================
// UPDATE MARKET VALUES FROM EBAY SOLD LISTINGS
// ============================================================

async function updateMarketValues(token) {
  console.log('Updating market values from sold listings...');
  for (const refKey of Object.keys(FALLBACK_VALUES)) {
    try {
      if (refKey.startsWith('WSSA')) continue;
      const params = new URLSearchParams({
        q: refKey,
        category_ids: '31387',
        filter: 'buyingOptions:{FIXED_PRICE},conditionIds:{1000|1500|2000|2500|3000},itemLocationCountry:GB',
        sort: 'price',
        limit: '50',
      });

      const response = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
        { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' } }
      );

      const data = await response.json();
      const items = data.itemSummaries || [];
      if (items.length < 3) continue;

      const prices = items
        .map(item => parseFloat(item.price?.value || 0))
        .filter(p => p > (({'WSSA0029':4000,'WSSA0018':5000,'126710BLRO':15000,'5711/1A':60000})[refKey] || 1500))
        .sort((a, b) => a - b);

      if (prices.length < 3) continue;

      const mid = Math.floor(prices.length / 2);
      const median = prices.length % 2 === 0
        ? (prices[mid - 1] + prices[mid]) / 2
        : prices[mid];
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

      await fetch(`${process.env.SUPABASE_URL}/rest/v1/market_values?on_conflict=reference_number`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          reference_number: refKey,
          brand_name: FALLBACK_VALUES[refKey]?.name?.split(' ')[0] || 'Unknown',
          model_name: FALLBACK_VALUES[refKey]?.name || refKey,
          median_sold_price: Math.round(median),
          avg_sold_price: Math.round(avg),
          min_sold_price: Math.round(prices[0]),
          max_sold_price: Math.round(prices[prices.length - 1]),
          sample_size: prices.length,
          last_updated: new Date().toISOString(),
        }),
      });

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`Market value update failed for ${refKey}: ${err.message}`);
    }
  }
}

// ============================================================
// GET MARKET VALUES FROM SUPABASE
// ============================================================

async function getMarketValues() {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/market_values?select=*`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  );
  const data = await response.json();
  const map = {};
  if (Array.isArray(data)) {
    for (const row of data) {
      map[row.reference_number] = row.median_sold_price;
    }
  }
  return map;
}

// ============================================================
// EBAY SEARCH
// ============================================================

async function searchEbay(token, query, maxResults = 50) {
  const params = new URLSearchParams({
    q: query,
    category_ids: '31387',
    filter: 'buyingOptions:{FIXED_PRICE|AUCTION},conditionIds:{1000|1500|2000|2500|3000}',
    sort: 'newlyListed',
    limit: String(maxResults),
  });

  const response = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' } }
  );
  const data = await response.json();
  return data.itemSummaries || [];
}

// ============================================================
// SCRAPE ALL WATCHES
// ============================================================

async function scrapeAllWatches(token, marketValues) {
  const allListings = [];
  const seen = new Set();

  for (const searchConfig of SEARCH_QUERIES) {
    try {
      const items = await searchEbay(token, searchConfig.query);
      console.log(`Query: "${searchConfig.query}" -> ${items.length} results`);

      for (const item of items) {
        if (seen.has(item.itemId)) continue;
        seen.add(item.itemId);

        const price = parseFloat(item.price?.value || 0);
        if (price < 1500) continue;

        const fallback = FALLBACK_VALUES[searchConfig.refKey];
        const marketValue = marketValues[searchConfig.refKey] || fallback?.value || 0;
        const hotThreshold = fallback?.hotThreshold || marketValue * 0.85;

        if (isSuspicious(item, price, marketValue)) {
          console.log(`Filtered: ${item.title} at £${price}`);
          continue;
        }

        const discountPct = marketValue > 0
          ? Math.round(((marketValue - price) / marketValue) * 100)
          : 0;

        const isDeal = discountPct >= 12;
        const isHot = price <= hotThreshold;
        const isDiscontinued = fallback?.discontinued || false;
        const isPriorityAlert = isDiscontinued && isHot;

        allListings.push({
          external_id: item.itemId,
          source: 'ebay_uk',
          brand_name: searchConfig.brand,
          model: item.title,
          reference_number: searchConfig.refKey,
          ref_number: searchConfig.refKey,
          price: price,
          price_gbp: price,
          currency: 'GBP',
          market_value: marketValue,
          discount_pct: discountPct,
          is_deal: isDeal || isHot,
          is_hot: isHot,
          is_priority_alert: isPriorityAlert,
          is_discontinued_model: isDiscontinued,
          search_priority: searchConfig.priority,
          listing_url: item.itemWebUrl,
          image_urls: item.image?.imageUrl ? [item.image.imageUrl] : [],
          condition: item.condition || null,
          seller_name: item.seller?.username || null,
          last_seen_at: new Date().toISOString(),
          is_active: true,
        });
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`Search failed for "${searchConfig.query}": ${err.message}`);
    }
  }

  return allListings;
}

// ============================================================
// SAVE TO SUPABASE
// ============================================================

async function saveToSupabase(listings) {
  if (listings.length === 0) return { saved: 0, deals: 0, supabaseError: null };

  const batchSize = 50;
  let totalSaved = 0;
  let totalDeals = 0;
  let lastError = null;

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/listings?on_conflict=source,external_id`,
      {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
          'on-conflict': 'source,external_id',
        },
        body: JSON.stringify(batch),
      }
    );

    if (response.ok) {
      totalSaved += batch.length;
      totalDeals += batch.filter(l => l.is_deal || l.is_hot).length;
      console.log(`Supabase batch saved: ${batch.length}`);
    } else {
      lastError = await response.text();
      console.error(`Supabase batch error: ${lastError}`);
      break;
    }
  }

  return { saved: totalSaved, deals: totalDeals, supabaseError: lastError };
}
