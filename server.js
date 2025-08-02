const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use((req, res, next) => {
  console.log(`📡 Incoming request: ${req.method} ${req.url}`);
  next();
});

app.post('/twilio-webhook', (req, res) => {
  console.log("📞 Twilio hit /twilio-webhook");

  const response = new twiml.VoiceResponse();
  const gather = response.gather({
    numDigits: 1,
    action: '/gather-response',
    method: 'POST',
  });

  gather.say("Thanks for calling. Press any key to begin.");

  res.type('text/xml');
  res.send(response.toString());
});

app.post('/gather-response', (req, res) => {
  console.log("🎯 Key pressed — hitting /gather-response");

  const response = new twiml.VoiceResponse();
  response.start().stream({
    url: 'wss://48715b34d842.ngrok-free.app/ws'
  });

  response.say("Streaming audio now.");
  response.pause({ length: 10 });

  res.type('text/xml');
  res.send(response.toString());
});

app.listen(3000, () => {
  console.log("✅ Express server running at http://localhost:3000");
});
