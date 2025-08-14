require('dotenv').config();

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { twiml } = require('twilio');
const { createClient } = require('@deepgram/sdk');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

// ✅ WebSocket stream handler (diagnostics only — no GPT here)
wss.on('connection', ws => {
  console.log('🔌 Media stream connected');

  const dg = deepgram.listen.live({
    model: 'nova',
    language: 'en-US',
    punctuate: true
  });

  dg.on('open', () => console.log('✅ Deepgram connection opened'));
  dg.on('error', err => console.error('❌ Deepgram error:', err));
  dg.on('close', () => console.log('🔕 Deepgram connection closed'));

  dg.on('transcriptReceived', data => {
    const text = data.channel.alternatives[0]?.transcript;
    if (text && text.trim() !== '') {
      console.log('📝 Transcript:', text);
    }
  });

  ws.on('message', msg => {
    const d = JSON.parse(msg);

    if (d.event === 'media') {
      dg.send(Buffer.from(d.media.payload, 'base64'));
    }

    if (d.event === 'stop') {
      console.log('🛑 Media stream stopped by Twilio');
      dg.finish();
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
    dg.finish();
  });
});

// ✅ POST route for initial webhook
app.post('/twilio-webhook', (req, res) => {
  console.log('📞 Twilio hit /twilio-webhook');
  const response = new twiml.VoiceResponse();
  response.gather({ numDigits: 1, action: '/gather-response', method: 'POST' })
          .say('Press any key to begin.');
  res.type('text/xml').send(response.toString());
});

// ✅ POST route after key press — starts audio stream
app.post('/gather-response', (req, res) => {
  console.log('🎯 Key pressed — starting stream');

  // 👇 Stream URL: local or deployed
  const streamUrl = process.env.LOCAL_TEST === 'true'
    ? 'ws://localhost:2004/ws'  // Use 127.0.0.1 or your local IP if needed
    : `wss://${process.env.RENDER_EXTERNAL_URL}/ws`;

  console.log(`🔗 Stream URL: ${streamUrl}`);

  const response = new twiml.VoiceResponse();
  response.start().stream({ url: streamUrl });
  response.say('Streaming audio now');
  response.pause({ length: 15 }); // Prevents call from ending immediately
  res.type('text/xml').send(response.toString());
});

// ✅ Start server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`✅ Server listening at http://0.0.0.0:${port}`);
});
