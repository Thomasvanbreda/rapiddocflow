const crypto = require('crypto');

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;

function generateSignature(data, passphrase) {
  let str = Object.keys(data)
    .filter(k => k !== 'signature' && data[k] !== '' && data[k] !== null && data[k] !== undefined)
    .map(k => `${k}=${encodeURIComponent(String(data[k])).replace(/%20/g, '+')}`)
    .join('&');
  if (passphrase && passphrase.trim() !== '') {
    str += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`;
  }
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

    // This is the exact version that worked - all fields included, empty ones skipped by signature function
    const data = {
      merchant_id:       PAYFAST_MERCHANT_ID,
      merchant_key:      PAYFAST_MERCHANT_KEY,
      return_url:        'https://smartanswerpdf.com?payment=success',
      cancel_url:        'https://smartanswerpdf.com?payment=cancelled',
      notify_url:        'https://smartanswerpdf.com/.netlify/functions/payfast-itn',
      name_first:        firstName || '',
      name_last:         lastName || '',
      email_address:     email,
      cell_number:       '',
      amount:            '49.99',
      item_name:         'SmartAnswerPDF Pro - Monthly Subscription',
      item_description:  '',
      custom_int1:       '',
      custom_int2:       '',
      custom_int3:       '',
      custom_int4:       '',
      custom_int5:       '',
      custom_str1:       userId,
      custom_str2:       '',
      custom_str3:       '',
      custom_str4:       '',
      custom_str5:       '',
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
