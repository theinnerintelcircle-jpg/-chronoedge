// ============================================================
// ChronoEdge Pipeline — Updated June 2026
// Full watch list with reference numbers + 2026 market values
// ============================================================

export default async function handler(req, res) {
  // Cron secret check
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    const token = await getEbayToken();
    const allListings = await scrapeAllWatches(token);
    const { saved, deals } = await saveToSupabase(allListings);
    return res.status(200).json({
      success: true,
      totalSaved: saved,
      totalDeals: deals,
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
// MARKET VALUES (GBP) — Updated June 2026
// Source: WatchCharts, Chrono24, WatchGuys, Loupe — June 2026
// ============================================================

const MARKET_VALUES = {

  // ── ROLEX GMT-MASTER II ──────────────────────────────────
  // ⚠️ Pepsi DISCONTINUED April 14 2026 — prices rising fast
  '126710BLRO':        { name: 'Rolex GMT Pepsi',            value: 20000, discontinued: true,  hotThreshold: 16500 },
  '126710BLNR':        { name: 'Rolex GMT Batman/Batgirl',   value: 15500, discontinued: false, hotThreshold: 13500 },
  '126711CHNR':        { name: 'Rolex GMT Root Beer',        value: 18500, discontinued: false, hotThreshold: 16000 },
  '126715CHNR':        { name: 'Rolex GMT Root Beer Everose',value: 28000, discontinued: false, hotThreshold: 24000 },

  // ── ROLEX SUBMARINER ─────────────────────────────────────
  '126610LN':          { name: 'Rolex Submariner Black Date',value: 12000, discontinued: false, hotThreshold: 10500 },
  '126610LV':          { name: 'Rolex Submariner Starbucks', value: 13000, discontinued: false, hotThreshold: 11500 },
  '124060':            { name: 'Rolex Submariner No Date',   value: 10500, discontinued: false, hotThreshold: 9000  },
  '126613LB':          { name: 'Rolex Submariner Bluesy',    value: 16000, discontinued: false, hotThreshold: 14000 },
  '126613LN':          { name: 'Rolex Submariner Two-Tone',  value: 15000, discontinued: false, hotThreshold: 13000 },

  // ── ROLEX DAYTONA ────────────────────────────────────────
  '126500LN-panda':    { name: 'Rolex Daytona Panda',        value: 20000, discontinued: false, hotThreshold: 17000 },
  '126500LN-black':    { name: 'Rolex Daytona Black',        value: 18500, discontinued: false, hotThreshold: 16000 },
  '116500LN':          { name: 'Rolex Daytona 116500LN',     value: 19000, discontinued: false, hotThreshold: 16500 },
  '126515LN':          { name: 'Rolex Daytona Everose Oysterflex', value: 32000, discontinued: false, hotThreshold: 28000 },
  '126519LN':          { name: 'Rolex Daytona White Gold Oysterflex', value: 45000, discontinued: false, hotThreshold: 40000 },
  '126508':            { name: 'Rolex Daytona Yellow Gold',  value: 55000, discontinued: false, hotThreshold: 48000 },
  '126509':            { name: 'Rolex Daytona White Gold',   value: 52000, discontinued: false, hotThreshold: 45000 },

  // ── ROLEX DAY-DATE 40 ────────────────────────────────────
  '228238':            { name: 'Rolex Day-Date 40 Yellow Gold',     value: 38000, discontinued: false, hotThreshold: 33000 },
  '228235-olive':      { name: 'Rolex Day-Date 40 Olive Everose',   value: 33000, discontinued: false, hotThreshold: 28500 },
  '228235-chocolate':  { name: 'Rolex Day-Date 40 Chocolate Everose', value: 30000, discontinued: false, hotThreshold: 26000 },
  '228235-green':      { name: 'Rolex Day-Date 40 Green Everose',   value: 29000, discontinued: false, hotThreshold: 25000 },
  '228206':            { name: 'Rolex Day-Date 40 Ice Blue Platinum', value: 72000, discontinued: false, hotThreshold: 62000 },

  // ── ROLEX DATEJUST 41 ────────────────────────────────────
  '126334-mint':       { name: 'Rolex Datejust 41 Mint Green',      value: 11000, discontinued: false, hotThreshold: 9500  },
  '126334-blue':       { name: 'Rolex Datejust 41 Blue',            value: 10500, discontinued: false, hotThreshold: 9000  },
  '126334-wimbledon':  { name: 'Rolex Datejust 41 Wimbledon',       value: 13000, discontinued: false, hotThreshold: 11000 },
  '126334-black':      { name: 'Rolex Datejust 41 Black',           value: 10000, discontinued: false, hotThreshold: 8500  },
  '126300':            { name: 'Rolex Datejust 41 Steel Oyster',     value: 9000,  discontinued: false, hotThreshold: 7500  },

  // ── ROLEX DATEJUST 36 ────────────────────────────────────
  '126234-mint':       { name: 'Rolex Datejust 36 Mint Green',      value: 10000, discontinued: false, hotThreshold: 8500  },
  '126234-blue':       { name: 'Rolex Datejust 36 Blue',            value: 9500,  discontinued: false, hotThreshold: 8000  },
  '126234-wimbledon':  { name: 'Rolex Datejust 36 Wimbledon',       value: 11500, discontinued: false, hotThreshold: 9800  },
  '126200':            { name: 'Rolex Datejust 36 Steel',            value: 8500,  discontinued: false, hotThreshold: 7200  },

  // ── ROLEX SKY-DWELLER ───────────────────────────────────
  '336934-blue':       { name: 'Rolex Sky-Dweller Blue Jubilee',    value: 20000, discontinued: false, hotThreshold: 17500 },
  '336934-green':      { name: 'Rolex Sky-Dweller Green Jubilee',   value: 19000, discontinued: false, hotThreshold: 16500 },

  // ── PATEK PHILIPPE ───────────────────────────────────────
  '5711/1A':           { name: 'Patek Nautilus 5711 Steel',         value: 90000, discontinued: true,  hotThreshold: 78000 },
  '5811/1G':           { name: 'Patek Nautilus 5811 White Gold',    value: 95000, discontinued: false, hotThreshold: 82000 },
  '5167A':             { name: 'Patek Aquanaut 5167A',              value: 38000, discontinued: false, hotThreshold: 33000 },
  '5164A':             { name: 'Patek Aquanaut Travel Time',        value: 52000, discontinued: false, hotThreshold: 45000 },

  // ── AUDEMARS PIGUET ──────────────────────────────────────
  '15500ST':           { name: 'AP Royal Oak 15500ST',              value: 38000, discontinued: false, hotThreshold: 33000 },
  '16202ST':           { name: 'AP Royal Oak Extra-Thin 16202ST',   value: 62000, discontinued: false, hotThreshold: 54000 },
  '26240ST':           { name: 'AP Royal Oak Chronograph 26240ST',  value: 48000, discontinued: false, hotThreshold: 42000 },

  // ── RICHARD MILLE ────────────────────────────────────────
  'RM 011':            { name: 'Richard Mille RM 011',              value: 120000, discontinued: false, hotThreshold: 104000 },
  'RM 035':            { name: 'Richard Mille RM 035',              value: 95000,  discontinued: false, hotThreshold: 82000  },
  'RM 055':            { name: 'Richard Mille RM 055',              value: 90000,  discontinued: false, hotThreshold: 78000  },
  'RM 65-01':          { name: 'Richard Mille RM 65-01',            value: 180000, discontinued: false, hotThreshold: 155000 },

  // ── CARTIER ──────────────────────────────────────────────
  'WSSA0029':          { name: 'Cartier Santos Medium',             value: 7500,  discontinued: false, hotThreshold: 6500  },
  'WSSA0018':          { name: 'Cartier Santos Large',              value: 8200,  discontinued: false, hotThreshold: 7100  },
};

// ============================================================
// SEARCH QUERIES
// Grouped by brand — ref numbers + keyword variants
// ============================================================

const SEARCH_QUERIES = [

  // ── ROLEX GMT (HIGH PRIORITY — Pepsi discontinued) ───────
  { query: '126710BLRO Rolex GMT Pepsi', brand: 'Rolex', refKey: '126710BLRO',       priority: 'HIGH' },
  { query: 'Rolex GMT Master Pepsi red blue bezel',       brand: 'Rolex', refKey: '126710BLRO', priority: 'HIGH' },
  { query: '126710BLNR Rolex GMT Batman',                 brand: 'Rolex', refKey: '126710BLNR', priority: 'NORMAL' },
  { query: 'Rolex GMT Batman blue black bezel jubilee',   brand: 'Rolex', refKey: '126710BLNR', priority: 'NORMAL' },
  { query: '126711CHNR Rolex GMT Root Beer',              brand: 'Rolex', refKey: '126711CHNR', priority: 'NORMAL' },
  { query: '126715CHNR Rolex GMT Everose Root Beer',      brand: 'Rolex', refKey: '126715CHNR', priority: 'NORMAL' },

  // ── ROLEX SUBMARINER ─────────────────────────────────────
  { query: '126610LN Rolex Submariner black date',        brand: 'Rolex', refKey: '126610LN',    priority: 'NORMAL' },
  { query: '126610LV Rolex Submariner Starbucks green',   brand: 'Rolex', refKey: '126610LV',    priority: 'NORMAL' },
  { query: '124060 Rolex Submariner no date',             brand: 'Rolex', refKey: '124060',      priority: 'NORMAL' },
  { query: '126613LB Rolex Submariner Bluesy blue gold',  brand: 'Rolex', refKey: '126613LB',    priority: 'NORMAL' },
  { query: '126613LN Rolex Submariner two tone black',    brand: 'Rolex', refKey: '126613LN',    priority: 'NORMAL' },

  // ── ROLEX DAYTONA ────────────────────────────────────────
  { query: '126500LN Rolex Daytona white panda dial',     brand: 'Rolex', refKey: '126500LN-panda', priority: 'NORMAL' },
  { query: '126500LN Rolex Daytona black ceramic',        brand: 'Rolex', refKey: '126500LN-black', priority: 'NORMAL' },
  { query: '116500LN Rolex Daytona ceramic panda',        brand: 'Rolex', refKey: '116500LN',   priority: 'NORMAL' },
  { query: '126515LN Rolex Daytona Everose Oysterflex',   brand: 'Rolex', refKey: '126515LN',   priority: 'NORMAL' },
  { query: '126508 Rolex Daytona yellow gold',            brand: 'Rolex', refKey: '126508',     priority: 'NORMAL' },

  // ── ROLEX DAY-DATE 40 ────────────────────────────────────
  { query: '228235 Rolex Day-Date olive green dial',      brand: 'Rolex', refKey: '228235-olive',     priority: 'NORMAL' },
  { query: '228235 Rolex Day-Date chocolate dial',        brand: 'Rolex', refKey: '228235-chocolate', priority: 'NORMAL' },
  { query: '228235 Rolex Day-Date green rose gold',       brand: 'Rolex', refKey: '228235-green',     priority: 'NORMAL' },
  { query: '228238 Rolex Day-Date yellow gold president', brand: 'Rolex', refKey: '228238',            priority: 'NORMAL' },
  { query: '228206 Rolex Day-Date ice blue platinum',     brand: 'Rolex', refKey: '228206',            priority: 'NORMAL' },

  // ── ROLEX DATEJUST 41 ────────────────────────────────────
  { query: '126334 Rolex Datejust 41 mint green jubilee', brand: 'Rolex', refKey: '126334-mint',      priority: 'NORMAL' },
  { query: '126334 Rolex Datejust 41 blue fluted jubilee',brand: 'Rolex', refKey: '126334-blue',      priority: 'NORMAL' },
  { query: '126334 Rolex Datejust 41 wimbledon slate',    brand: 'Rolex', refKey: '126334-wimbledon', priority: 'NORMAL' },
  { query: '126334 Rolex Datejust 41 black dial',         brand: 'Rolex', refKey: '126334-black',     priority: 'NORMAL' },

  // ── ROLEX DATEJUST 36 ────────────────────────────────────
  { query: '126234 Rolex Datejust 36 mint green',         brand: 'Rolex', refKey: '126234-mint',      priority: 'NORMAL' },
  { query: '126234 Rolex Datejust 36 wimbledon',          brand: 'Rolex', refKey: '126234-wimbledon', priority: 'NORMAL' },
  { query: '126234 Rolex Datejust 36 blue fluted',        brand: 'Rolex', refKey: '126234-blue',      priority: 'NORMAL' },

  // ── ROLEX SKY-DWELLER ───────────────────────────────────
  { query: '336934 Rolex Sky-Dweller blue jubilee',       brand: 'Rolex', refKey: '336934-blue',  priority: 'NORMAL' },
  { query: '336934 Rolex Sky-Dweller green jubilee',      brand: 'Rolex', refKey: '336934-green', priority: 'NORMAL' },

  // ── PATEK PHILIPPE ───────────────────────────────────────
  { query: '5711 Patek Philippe Nautilus steel blue',     brand: 'Patek Philippe', refKey: '5711/1A',  priority: 'HIGH' },
  { query: '5811 Patek Philippe Nautilus white gold',     brand: 'Patek Philippe', refKey: '5811/1G',  priority: 'HIGH' },
  { query: '5167A Patek Philippe Aquanaut steel',         brand: 'Patek Philippe', refKey: '5167A',    priority: 'NORMAL' },
  { query: '5164A Patek Aquanaut travel time',            brand: 'Patek Philippe', refKey: '5164A',    priority: 'NORMAL' },

  // ── AUDEMARS PIGUET ──────────────────────────────────────
  { query: '15500ST Audemars Piguet Royal Oak steel',     brand: 'Audemars Piguet', refKey: '15500ST', priority: 'NORMAL' },
  { query: '16202ST AP Royal Oak extra thin jumbo',       brand: 'Audemars Piguet', refKey: '16202ST', priority: 'HIGH'   },
  { query: '26240ST AP Royal Oak chronograph',            brand: 'Audemars Piguet', refKey: '26240ST', priority: 'NORMAL' },

  // ── RICHARD MILLE ────────────────────────────────────────
  { query: 'Richard Mille RM 011 titanium flyback',       brand: 'Richard Mille', refKey: 'RM 011',   priority: 'NORMAL' },
  { query: 'Richard Mille RM 035 NTPT carbon',            brand: 'Richard Mille', refKey: 'RM 035',   priority: 'NORMAL' },
  { query: 'Richard Mille RM 055 bubba watson',           brand: 'Richard Mille', refKey: 'RM 055',   priority: 'NORMAL' },
  { query: 'Richard Mille RM 65-01 split seconds',        brand: 'Richard Mille', refKey: 'RM 65-01', priority: 'NORMAL' },

  // ── CARTIER ──────────────────────────────────────────────
  { query: 'WSSA0029 Cartier Santos medium steel',        brand: 'Cartier', refKey: 'WSSA0029', priority: 'NORMAL' },
  { query: 'WSSA0018 Cartier Santos large steel',         brand: 'Cartier', refKey: 'WSSA0018', priority: 'NORMAL' },
  { query: 'Cartier Santos Dumont steel gold',            brand: 'Cartier', refKey: 'WSSA0018', priority: 'NORMAL' },
];

// ============================================================
// EBAY SEARCH
// ============================================================

async function searchEbay(token, query, maxResults = 50) {
  const params = new URLSearchParams({
    q: query,
    category_ids: '31387', // eBay UK Wristwatches
    filter: 'buyingOptions:{FIXED_PRICE|AUCTION},conditionIds:{1000|1500|2000|2500|3000}',
    sort: 'newlyListed',
    limit: String(maxResults),
    marketplace_id: 'EBAY_GB',
  });

  const response = await fetch(
    `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
      },
    }
  );

  const data = await response.json();
  return data.itemSummaries || [];
}

async function scrapeAllWatches(token) {
  const allListings = [];
  const seen = new Set();

  for (const searchConfig of SEARCH_QUERIES) {
    try {
      const items = await searchEbay(token, searchConfig.query);

      for (const item of items) {
        if (seen.has(item.itemId)) continue;
        seen.add(item.itemId);

        const price = parseFloat(item.price?.value || 0);
        if (price < 500) continue; // skip junk listings

        const marketData = MARKET_VALUES[searchConfig.refKey];
        const marketValue = marketData?.value || 0;
        const discount = marketValue > 0
          ? Math.round(((marketValue - price) / marketValue) * 100)
          : 0;

        const isDeal = discount >= 8;
        const isHotDeal = price <= (marketData?.hotThreshold || 0);
        const isDiscontinued = marketData?.discontinued || false;

        // Discontinued + under hot threshold = PRIORITY ALERT
        const isPriorityAlert = isDiscontinued && isHotDeal;

        allListings.push({
          external_id: item.itemId,
          source: 'ebay_uk',
          brand: searchConfig.brand,
          model: item.title,
          ref_number: searchConfig.refKey,
          price,
          currency: 'GBP',
          market_value: marketValue,
          discount_percent: discount,
          is_deal: isDeal || isHotDeal,
          is_hot_deal: isHotDeal,
          is_priority_alert: isPriorityAlert,
          is_discontinued_model: isDiscontinued,
          search_priority: searchConfig.priority,
          listing_url: item.itemWebUrl,
          image_url: item.image?.imageUrl || null,
          condition: item.condition || null,
          seller: item.seller?.username || null,
          scraped_at: new Date().toISOString(),
        });
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (err) {
      console.error(`Search failed for "${searchConfig.query}":`, err.message);
    }
  }

  return allListings;
}

// ============================================================
// SAVE TO SUPABASE
// ============================================================

async function saveToSupabase(listings) {
  if (listings.length === 0) return { saved: 0, deals: 0 };

  // Upsert in batches of 50
  const batchSize = 50;
  let totalSaved = 0;
  let totalDeals = 0;

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/listings`,
      {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(batch),
      }
    );

    if (response.ok) {
      totalSaved += batch.length;
      totalDeals += batch.filter(l => l.is_deal || l.is_hot_deal).length;
    } else {
      const err = await response.text();
      console.error('Supabase batch error:', err);
    }
  }

  return { saved: totalSaved, deals: totalDeals };
}
