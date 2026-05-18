const https = require('https');
const crypto = require('crypto');

const SUPABASE_URL = 'https://dvuatrfhvwnmmqxdsaxx.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;
const PAYFAST_API_HOST = 'api.payfast.co.za';

function generateAPISignature(data, passphrase) {
  const combined = { ...data, passphrase };
  let str = Object.keys(combined)
    .sort()
    .filter(k => k !== 'signature')
    .map(k => `${k}=${encodeURIComponent(String(combined[k])).replace(/%20/g, '+')}`)
    .join('&');
  return crypto.createHash('md5').update(str).digest('hex');
}

function cancelPayFastSubscription(token) {
  const timestamp = new Date().toISOString().split('.')[0];
  const passphrase = (PAYFAST_PASSPHRASE || '').trim();
  const headerData = {
    'merchant-id': PAYFAST_MERCHANT_ID,
    'timestamp':   timestamp,
    'version':     'v1',
  };
  const signature = generateAPISignature(headerData, passphrase);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: PAYFAST_API_HOST,
      path: `/subscriptions/${token}/cancel`,
      method: 'PUT',
      headers: {
        'merchant-id':  PAYFAST_MERCHANT_ID,
        'timestamp':    timestamp,
        'version':      'v1',
        'signature':    signature,
        'Content-Type': 'application/json',
        'Content-Length': 0,
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
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
        'Prefer': 'return=minimal'
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
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const { userId } = JSON.parse(event.body);
    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing userId' }) };
    }

    // Step 1: Get profile to check for active PayFast subscription
    const profileRes = await supabaseRequest('GET', 
      `/rest/v1/profiles?id=eq.${userId}&select=payfast_token,subscription_status,subscription_source`
    );
    const profiles = JSON.parse(profileRes.body);
    const profile = profiles && profiles[0];

    // Step 2: Cancel PayFast subscription if active
    if (profile && 
        profile.subscription_status === 'active' && 
        profile.subscription_source === 'payfast' && 
        profile.payfast_token) {
      try {
        const cancelRes = await cancelPayFastSubscription(profile.payfast_token);
        console.log(`PayFast cancel on account delete: ${cancelRes.status}`, cancelRes.body);
      } catch (err) {
        console.error('PayFast cancel failed during account delete (continuing):', err);
        // Don't block account deletion if PayFast cancel fails
      }
    }

    // Step 3: Delete all templates
    await supabaseRequest('DELETE', `/rest/v1/templates?user_id=eq.${userId}`);

    // Step 4: Delete profile
    await supabaseRequest('DELETE', `/rest/v1/profiles?id=eq.${userId}`);

    // Step 5: Delete the auth user
    const deleteRes = await supabaseRequest('DELETE', `/auth/v1/admin/users/${userId}`);

    if (deleteRes.status === 200 || deleteRes.status === 204) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true })
      };
    } else {
      console.error('Auth delete failed:', deleteRes.status, deleteRes.body);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to delete auth record' })
      };
    }

  } catch (err) {
    console.error('Delete account error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};
