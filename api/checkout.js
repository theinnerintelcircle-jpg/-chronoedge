export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { plan } = req.body;
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID;
  const DEALER_PRICE_ID = process.env.STRIPE_DEALER_PRICE_ID;

  const priceId = plan === 'dealer' ? DEALER_PRICE_ID : PREMIUM_PRICE_ID;

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        'success_url': 'https://chronoedge.net/success',
        'cancel_url': 'https://chronoedge.net/#pricing'
      })
    });

    const session = await response.json();

    if (session.url) {
      return res.status(200).json({ url: session.url });
    } else {
      return res.status(500).json({ error: 'Failed to create session', details: session });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
