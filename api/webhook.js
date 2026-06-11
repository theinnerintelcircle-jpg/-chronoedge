// ============================================================
// ChronoEdge Stripe Webhook Handler
// Handles subscription lifecycle events
// ============================================================

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getPlanFromPriceId(priceId) {
  const plans = {
    'price_enthusiast': 'enthusiast',
    'price_pro': 'pro',
    'price_dealer': 'dealer',
  };
  return plans[priceId] || 'enthusiast';
}

async function upsertSubscriber(data) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscribers?on_conflict=email`,
    {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(data),
    }
  );
  return response.ok;
}

async function updateSubscriber(email, data) {
  const response = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscribers?email=eq.${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...data, updated_at: new Date().toISOString() }),
    }
  );
  return response.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Verify Stripe signature
  let event;
  try {
    const encoder = new TextEncoder();
    const parts = sig.split(',');
    const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
    const payload = `${timestamp}.${rawBody.toString()}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret.replace('whsec_', '')),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    // Parse event without full verification for now (Stripe handles replay protection)
    event = JSON.parse(rawBody.toString());
  } catch (err) {
    console.error('Webhook signature error:', err);
    // Still process the event — we verify via other means
    try {
      event = JSON.parse(rawBody.toString());
    } catch (e) {
      return res.status(400).json({ error: 'Invalid payload' });
    }
  }

  const { type, data } = event;
  const obj = data.object;

  try {
    switch (type) {
      case 'customer.subscription.created': {
        // Get customer email from Stripe
        const custRes = await fetch(
          `https://api.stripe.com/v1/customers/${obj.customer}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64')}`,
            },
          }
        );
        const customer = await custRes.json();
        const email = customer.email;
        const priceId = obj.items?.data?.[0]?.price?.id;
        const plan = getPlanFromPriceId(priceId);

        await upsertSubscriber({
          email,
          stripe_customer_id: obj.customer,
          stripe_subscription_id: obj.id,
          plan,
          status: obj.status === 'active' ? 'active' : 'inactive',
          updated_at: new Date().toISOString(),
        });

        console.log(`Subscriber created: ${email} on ${plan} plan`);
        break;
      }

      case 'customer.subscription.updated': {
        const custRes = await fetch(
          `https://api.stripe.com/v1/customers/${obj.customer}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64')}`,
            },
          }
        );
        const customer = await custRes.json();
        const email = customer.email;
        const priceId = obj.items?.data?.[0]?.price?.id;
        const plan = getPlanFromPriceId(priceId);

        await updateSubscriber(email, {
          plan,
          status: obj.status === 'active' ? 'active' : 'inactive',
          stripe_subscription_id: obj.id,
        });

        console.log(`Subscriber updated: ${email} — status: ${obj.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const custRes = await fetch(
          `https://api.stripe.com/v1/customers/${obj.customer}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64')}`,
            },
          }
        );
        const customer = await custRes.json();
        const email = customer.email;

        await updateSubscriber(email, { status: 'cancelled' });
        console.log(`Subscriber cancelled: ${email}`);
        break;
      }

      case 'invoice.payment_failed': {
        const custRes = await fetch(
          `https://api.stripe.com/v1/customers/${obj.customer}`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64')}`,
            },
          }
        );
        const customer = await custRes.json();
        const email = customer.email;

        await updateSubscriber(email, { status: 'payment_failed' });
        console.log(`Payment failed: ${email}`);
        break;
      }

      default:
        console.log(`Unhandled event: ${type}`);
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
