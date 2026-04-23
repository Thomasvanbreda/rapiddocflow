const https = require('https');
const crypto = require('crypto');

// ── CONFIG — values come from Netlify Environment Variables ─────────────────
const PAYFAST_MERCHANT_ID = '34676581';
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;
const SUPABASE_URL = 'https://dvuatrfhvwnmmqxdsaxx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ── HELPERS ─────────────────────────────────────────────────────────────────
function generateSignature(data, passphrase) {
  let str = Object.keys(data)
    .filter(k => k !== 'signature' && data[k] !== '')
    .sort()
    .map(k => `${k}=${encodeURIComponent(data[k]).replace(/%20/g, '+')}`)
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

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
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
      await supabaseUpdate(userId, 'active', token);
      console.log(`Subscription activated for user ${userId}`);
    } else if (paymentStatus === 'CANCELLED') {
      await supabaseUpdate(userId, 'free', null);
      console.log(`Subscription cancelled for user ${userId}`);
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('ITN error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
