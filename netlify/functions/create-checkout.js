const crypto = require('crypto');

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;

function pfEncode(val) {
  return encodeURIComponent(String(val).trim())
    .replace(/%20/g, '+')
    .replace(/%[0-9a-f]{2}/g, m => m.toUpperCase());
}

function generateSignature(data, passphrase) {
  const str = Object.entries(data)
    .filter(([k, v]) => k !== 'signature' && String(v).trim() !== '')
    .map(([k, v]) => `${k}=${pfEncode(v)}`)
    .join('&')
    + (passphrase ? `&passphrase=${pfEncode(passphrase)}` : '');
  console.log('Signature string:', str);
  return crypto.createHash('md5').update(str).digest('hex');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  try {
    const body = JSON.parse(event.body);
    const { userId, email, firstName, lastName } = body;
    if (!userId || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }
    const passphrase = (PAYFAST_PASSPHRASE || '').trim();

    const data = {
      merchant_id:       PAYFAST_MERCHANT_ID,
      merchant_key:      PAYFAST_MERCHANT_KEY,
      return_url:        'https://smartanswerpdf.com?payment=success',
      cancel_url:        'https://smartanswerpdf.com?payment=cancelled',
      notify_url:        'https://smartanswerpdf.com/.netlify/functions/payfast-itn',
      name_first:        (firstName || '').trim(),
      name_last:         (lastName || '').trim(),
      email_address:     email.trim(),
      amount:            '49.99',
      item_name:         'SmartAnswerPDF Pro - Monthly Subscription',
      custom_str1:       userId,
      subscription_type: '1',
      billing_date:      new Date().toISOString().split('T')[0],
      recurring_amount:  '49.99',
      frequency:         '3',
      cycles:            '0',
    };

    data.signature = generateSignature(data, passphrase);
    console.log('Generated signature:', data.signature);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: data })
    };
  } catch (err) {
    console.error('Checkout error:', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error', detail: err.message }) };
  }
};
