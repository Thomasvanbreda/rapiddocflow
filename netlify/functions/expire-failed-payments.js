/**
 * expire-failed-payments.js
 * Netlify scheduled function — runs daily at 06:00 UTC
 *
 * Finds any active PayFast subscribers whose payment_failed_at
 * is older than GRACE_PERIOD_DAYS and drops them to free.
 *
 * This is a safety net in case PayFast does not send a second
 * FAILED ITN after the retry attempt.
 */

const https = require('https');

const SUPABASE_URL = 'https://dvuatrfhvwnmmqxdsaxx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GRACE_PERIOD_DAYS = 5;

function supabaseRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': method === 'GET' ? 'count=exact' : 'return=representation',
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

exports.handler = async () => {
  console.log('expire-failed-payments: starting run');

  try {
    // Calculate the cutoff — anyone whose payment_failed_at is older than this gets dropped
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - GRACE_PERIOD_DAYS);
    const cutoffISO = cutoff.toISOString();

    // Find all active PayFast users whose grace period has expired
    const res = await supabaseRequest(
      'GET',
      `/rest/v1/profiles?subscription_status=eq.active&subscription_source=eq.payfast&payment_failed_at=lt.${encodeURIComponent(cutoffISO)}&select=id,email,payment_failed_at`
    );

    const expired = res.body;

    if (!Array.isArray(expired) || expired.length === 0) {
      console.log('expire-failed-payments: no expired grace periods found');
      return { statusCode: 200, body: 'No expired grace periods' };
    }

    console.log(`expire-failed-payments: found ${expired.length} user(s) to drop`);

    // Drop each one to free
    for (const user of expired) {
      await supabaseRequest('PATCH', `/rest/v1/profiles?id=eq.${user.id}`, {
        subscription_status: 'free',
        subscription_source: 'payfast',
        payment_failed_at: null,
        subscription_end_date: null,
      });
      console.log(`expire-failed-payments: dropped ${user.email} (failed at ${user.payment_failed_at})`);
    }

    return {
      statusCode: 200,
      body: `Dropped ${expired.length} user(s) to free after grace period`
    };

  } catch (err) {
    console.error('expire-failed-payments error:', err);
    return { statusCode: 500, body: 'Error' };
  }
};
