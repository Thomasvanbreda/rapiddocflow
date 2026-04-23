const crypto = require('crypto');

const PAYFAST_MERCHANT_ID = process.env.PAYFAST_MERCHANT_ID;
const PAYFAST_MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY;
const PAYFAST_PASSPHRASE = process.env.PAYFAST_PASSPHRASE;

function generateSignature(data, passphrase) {
  let output = '';
  for (let key in data) {
    if (key !== 'signature' && data[key] !== '') {
      output += key + '=' + encodeURIComponent(data[key]).replace(/%20/g, '+') + '&';
    }
  }
  // Remove trailing &
  let str = output.slice(0, -1);
  if (passphrase) {
    str += '&passphrase=' + encodeURIComponent(passphrase).replace(/%20/g, '+');
  }
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
      recurring_amount: '49.99',
      frequency: '3',
      cycles: '0',
      custom_str1: userId,
    };
    data.signature = generateSignature(data, PAYFAST_PASSPHRASE);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: data })
    };
  } catch (err) {
    console.error('Checkout error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error' }) };
  }
};
