const https = require('https');
const crypto = require('crypto');

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;
const SUPABASE_URL = 'https://dvuatrfhvwnmmqxdsaxx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const GRACE_PERIOD_DAYS = 5;

function generateSignature(data, passphrase) {
  let str = Object.keys(data)
    .filter(k => k !== 'signature')
    .map(k => `${k}=${encodeURIComponent(String(data[k] ?? '')).replace(/%20/g, '+')}`)
    .join('&');
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

function supabaseGet(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });
}

function supabasePatch(userId, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`);
    const payload = JSON.stringify(body);
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
    req.write(payload);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const params = Object.fromEntries(new URLSearchParams(event.body));

    // Verify PayFast signature
    const expectedSig = generateSignature(params, PAYFAST_PASSPHRASE);
    if (params.signature !== expectedSig) {
      console.error('Invalid PayFast signature');
      return { statusCode: 400, body: 'Invalid signature' };
    }

    const userId        = params.custom_str1;
    const paymentStatus = params.payment_status;
    const token         = params.token;

    if (!userId) {
      return { statusCode: 400, body: 'No user ID' };
    }

    console.log(`ITN received: userId=${userId} status=${paymentStatus} token=${token}`);

    // Get current profile so we can make smart decisions
    const profiles = await supabaseGet(`/rest/v1/profiles?id=eq.${userId}&select=subscription_status,subscription_source,payment_failed_at`);
    const profile = profiles[0];

    if (!profile) {
      console.error(`No profile found for userId=${userId}`);
      return { statusCode: 200, body: 'OK' }; // Return 200 so PayFast doesn't retry
    }

    const currentStatus = profile.subscription_status;

    // ── COMPLETE ───────────────────────────────────────────────────────────────
    if (paymentStatus === 'COMPLETE') {
      // Payment succeeded — activate and clear any failed payment flag
      await supabasePatch(userId, {
        subscription_status: 'active',
        subscription_source: 'payfast',
        subscription_date: new Date().toISOString(),
        payfast_token: token || null,
        payment_failed_at: null,        // Clear grace period flag
        subscription_end_date: null,    // Clear any end date
      });
      console.log(`Payment COMPLETE — activated userId=${userId}`);
    }

    // ── FAILED ────────────────────────────────────────────────────────────────
    else if (paymentStatus === 'FAILED') {
      // Only act on failed payments for currently active PayFast subscribers
      // Ignore if they are already cancelled, free, or manual pro
      if (currentStatus !== 'active' || profile.subscription_source !== 'payfast') {
        console.log(`FAILED ITN ignored — user is not an active PayFast subscriber (status=${currentStatus})`);
        return { statusCode: 200, body: 'OK' };
      }

      if (profile.payment_failed_at) {
        // Second (or subsequent) failure — grace period already started
        const firstFail  = new Date(profile.payment_failed_at);
        const graceEnds  = new Date(firstFail.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
        const now        = new Date();

        if (now > graceEnds) {
          // Grace period has expired — drop to free
          await supabasePatch(userId, {
            subscription_status: 'free',
            subscription_source: 'payfast',
            payment_failed_at: null,
            subscription_end_date: null,
          });
          console.log(`Grace period expired — dropped userId=${userId} to free`);
        } else {
          console.log(`FAILED again but still within grace period — userId=${userId} grace ends ${graceEnds.toISOString()}`);
        }
      } else {
        // First failure — start the grace period, keep them on active for now
        await supabasePatch(userId, {
          payment_failed_at: new Date().toISOString(),
        });
        console.log(`First payment failure — grace period started for userId=${userId}`);
      }
    }

    // ── CANCELLED ─────────────────────────────────────────────────────────────
    else if (paymentStatus === 'CANCELLED') {
      // PayFast confirms the subscription is cancelled on their side.
      // If the user cancelled via our app, status is already 'cancelled' with an end date — leave it.
      // If status is still 'active' (e.g. PayFast cancelled due to repeated failures),
      // drop them to free immediately with no grace period.
      if (currentStatus === 'active') {
        await supabasePatch(userId, {
          subscription_status: 'free',
          subscription_source: 'payfast',
          payment_failed_at: null,
          subscription_end_date: null,
        });
        console.log(`PayFast-initiated cancel (not user) — dropped userId=${userId} to free`);
      } else {
        console.log(`CANCELLED ITN received — user already in status=${currentStatus}, no change needed`);
      }
    }

    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error('ITN error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
