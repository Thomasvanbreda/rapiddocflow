const https = require('https');
const crypto = require('crypto');

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;
const SUPABASE_URL = 'https://dvuatrfhvwnmmqxdsaxx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Use sandbox endpoint while testing — swap to 'api.payfast.co.za' for live
const PAYFAST_API_HOST = 'api.payfast.co.za';

function generateAPISignature(data, passphrase) {
  let str = Object.keys(data)
    .sort()
    .map(k => `${k}=${encodeURIComponent(String(data[k] ?? '')).replace(/%20/g, '+')}`)
    .join('&');
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`;
  return crypto.createHash('md5').update(str).digest('hex');
}

function payfastRequest(path, method, data) {
  const timestamp = new Date().toISOString().split('.')[0]; // YYYY-MM-DDTHH:MM:SS
  const headers = {
    'merchant-id': PAYFAST_MERCHANT_ID,
    'timestamp': timestamp,
    'version': 'v1',
  };
  headers['signature'] = generateAPISignature({ ...headers }, PAYFAST_PASSPHRASE);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: PAYFAST_API_HOST,
      path,
      method,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function supabaseRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + path);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=representation'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    // Verify user is authenticated
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const { userId } = JSON.parse(event.body);
    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) };
    }

    // 1. Get the user's PayFast token and subscription_date from Supabase
    const profileRes = await supabaseRequest('GET', `/rest/v1/profiles?id=eq.${userId}&select=payfast_token,subscription_date,subscription_status,subscription_source`);
    const profiles = JSON.parse(profileRes.body);

    if (!profiles || !profiles.length) {
      return { statusCode: 404, body: JSON.stringify({ error: 'User not found' }) };
    }

    const profile = profiles[0];

    // Only PayFast paying users can cancel via this endpoint
    if (profile.subscription_status !== 'active' || profile.subscription_source !== 'payfast') {
      return { statusCode: 400, body: JSON.stringify({ error: 'No active PayFast subscription to cancel' }) };
    }

    if (!profile.payfast_token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No subscription token found' }) };
    }

    // 2. Calculate subscription_end_date
    // This is the date of the LAST successful payment + 1 month
    // i.e. they keep Pro access until the next billing date
    const subDate = new Date(profile.subscription_date);
    const now = new Date();

    // Find the most recent billing date on or before today
    // billing date is the same day-of-month as original subscription_date
    const billingDay = subDate.getDate();
    let endDate = new Date(now.getFullYear(), now.getMonth(), billingDay);

    // If the billing day this month hasn't happened yet, go back one month
    if (endDate > now) {
      endDate = new Date(now.getFullYear(), now.getMonth() - 1, billingDay);
    }

    // End date = last billing date + 1 month
    endDate = new Date(endDate.getFullYear(), endDate.getMonth() + 1, billingDay);
    endDate.setHours(23, 59, 59, 999); // End of that day

    // 3. Cancel the subscription with PayFast
    const cancelRes = await payfastRequest(
      `/subscriptions/${profile.payfast_token}/cancel`,
      'PUT',
      {}
    );

    console.log('PayFast cancel response:', cancelRes.status, cancelRes.body);

    // Accept 200 or 204 as success. On sandbox this may return 200.
    if (cancelRes.status !== 200 && cancelRes.status !== 204) {
      console.error('PayFast cancel failed:', cancelRes.status, cancelRes.body);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'PayFast cancellation failed', details: cancelRes.body })
      };
    }

    // 4. Update Supabase: status → 'cancelled', store end date
    await supabaseRequest('PATCH', `/rest/v1/profiles?id=eq.${userId}`, {
      subscription_status: 'cancelled',
      subscription_end_date: endDate.toISOString(),
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        subscription_end_date: endDate.toISOString()
      })
    };

  } catch (err) {
    console.error('Cancel subscription error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};
