const crypto = require('crypto');

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;

function generateSignature(data, passphrase) {
  let str = Object.keys(data)
    .filter(k => k !== 'signature')
    .map(k => `${k}=${encodeURIComponent(String(data[k] ?? '')).replace(/%20/g, '+')}`)
    .join('&');
  if (passphrase) str += `&passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`;
  return { sig: crypto.createHash('md5').update(str).digest('hex'), str };
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
    const data = {
      merchant_id: PAYFAST_MERCHANT_ID,
      merchant_key: PAYFAST_MERCHANT_KEY,
      return_url: 'https://smartanswerpdf.com?payment=success',
      cancel_url: 'https://smartanswerpdf.com?payment=cancelled',
      notify_url: 'https://smartanswerpdf.com/.netlify/functions/payfast-itn',
      name_first: firstName || '',
      name_last: lastName || '',
      email_address: email,
      amount: '49.99',
      item_name: 'SmartAnswerPDF Pro - Monthly Subscription',
      subscription_type: '1',
      billing_date: new Date().toISOString().split('T')[0],
      recurring_amount: '49.99',
      frequency: '3',
      cycles: '0',
      custom_str1: userId,
    };
    const { sig, str } = generateSignature(data, PAYFAST_PASSPHRASE);
    data.signature = sig;
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: data, debug_str: str, debug_sig: sig })
    };
  } catch (err) {
    console.error('Checkout error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};
