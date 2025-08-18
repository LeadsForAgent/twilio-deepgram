require('dotenv').config();
const twilio = require('twilio');

console.log("Loaded env:", {
  SID: process.env.TWILIO_ACCOUNT_SID,
  TOKEN: process.env.TWILIO_AUTH_TOKEN,
  FROM: process.env.TWILIO_PHONE_NUMBER,
});

const client = new twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const toPhoneNumber = '+16476797406';
const contactName = 'Adity test';
const fromPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_WEBHOOK_URL = 'https://express-server-rsa4.onrender.com/twilio-webhook';

async function makeCall() {
  try {
    console.log(`📞 Calling ${contactName} at ${toPhoneNumber}...`);
    console.log(`🌐 Using Webhook URL: ${TWILIO_WEBHOOK_URL}`);

    const call = await client.calls.create({
      url: TWILIO_WEBHOOK_URL,
      method: 'POST', // ensure webhook receives POST
      to: toPhoneNumber,
      from: fromPhoneNumber,
    });

    console.log(`✅ Call initiated. SID: ${call.sid}`);
  } catch (err) {
    console.error('❌ Call failed:', err.message);
  }
}

makeCall();
