const https = require('https');
const crypto = require('crypto');

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;
const SUPABASE_URL = 'https://dvuatrfhvwnmmqxdsaxx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function generateSignature(data, passphrase) {
  let str = Object.keys(data)
    .filter(k => k !== 'signature')
    .map(k => `${k}=${encodeURIComponent(String(data[k] ?? '')).replace(/%20/g, '+')}`)
    .join('&');
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

async function supabaseUpdate(userId, status, token) {
  const body = JSON.stringify({
    subscription_status: status,
    subscription_source: status === 'active' ? 'payfast' : 'manual',
    subscription_date: new Date().toISOString(),
    payfast_token: token || null
  });
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=minimal'
      }
    }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const params = Object.fromEntries(new URLSearchParams(event.body));

    // Verify signature
    const expectedSig = generateSignature(params, PAYFAST_PASSPHRASE);
    if (params.signature !== expectedSig) {
      console.error('Invalid signature');
      return { statusCode: 400, body: 'Invalid signature' };
    }

    const userId = params.custom_str1;
    const paymentStatus = params.payment_status;
    const token = params.token;

    if (!userId) {
      return { statusCode: 400, body: 'No user ID' };
    }

    if (paymentStatus === 'COMPLETE') {
      // Payment succeeded — ensure they are active (also handles reactivation)
      await supabaseUpdate(userId, 'active', token);
      console.log(`Subscription activated for user ${userId}`);
    } else if (paymentStatus === 'CANCELLED') {
      // PayFast confirms cancellation — subscription_end_date was already set
      // when the user clicked cancel. Just log it; the frontend expiry check
      // will flip them to 'free' once the end date passes.
      // We do NOT immediately drop to free here — they have paid-up time remaining.
      console.log(`Subscription cancellation confirmed by PayFast for user ${userId}`);
      // Status stays as 'cancelled' (already set by cancel-subscription function)
      // Only update if they are somehow still 'active' (edge case: ITN arrives before our function)
      const checkRes = await new Promise((resolve, reject) => {
        const url = new URL(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=subscription_status`);
        const req = require('https').request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'GET',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          }
        }, res => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(JSON.parse(data)));
        });
        req.on('error', reject);
        req.end();
      });
      const currentStatus = checkRes[0]?.subscription_status;
      if (currentStatus === 'active') {
        // Cancel button wasn't used — PayFast cancelled directly (e.g. failed payment)
        // Set to cancelled with no end date grace period — drop to free immediately
        await supabaseUpdate(userId, 'free', null);
        console.log(`Subscription force-cancelled (no grace period) for user ${userId}`);
      }
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('ITN error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
