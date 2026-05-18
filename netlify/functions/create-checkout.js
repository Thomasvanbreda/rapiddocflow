const crypto = require('crypto');

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { userId, email } = body;

    if (!userId || !email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    const passphrase = (PAYFAST_PASSPHRASE || '').trim();
    const billingDate = new Date().toISOString().split('T')[0];

    // Minimal fields only — no name fields at all
    const fields = [
      ['merchant_id',       PAYFAST_MERCHANT_ID],
      ['merchant_key',      PAYFAST_MERCHANT_KEY],
      ['return_url',        'https://smartanswerpdf.com?payment=success'],
      ['cancel_url',        'https://smartanswerpdf.com?payment=cancelled'],
      ['notify_url',        'https://smartanswerpdf.com/.netlify/functions/payfast-itn'],
      ['email_address',     email],
      ['amount',            '49.99'],
      ['item_name',         'SmartAnswerPDF Pro - Monthly Subscription'],
      ['subscription_type', '1'],
      ['billing_date',      billingDate],
      ['recurring_amount',  '49.99'],
      ['frequency',         '3'],
      ['cycles',            '0'],
      ['custom_str1',       userId],
    ];

    let sigStr = fields
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v ?? '')).replace(/%20/g, '+')}`)
      .join('&');

    if (passphrase) {
      sigStr += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`;
    }

    console.log('Signature string:', sigStr);

    const signature = crypto.createHash('md5').update(sigStr).digest('hex');
    console.log('Generated signature:', signature);

    const data = {};
    fields.forEach(([k, v]) => { data[k] = v ?? ''; });
    data.signature = signature;

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
