require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { twiml } = require('twilio');
const { createClient } = require('@deepgram/sdk');
const OpenAI = require('openai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ✅ Webhook to start the call
app.post('/twilio-webhook', (req, res) => {
  const response = new twiml.VoiceResponse();
  response.gather({ numDigits: 1, action: '/gather-response', method: 'POST' })
    .say('Press any key to begin.');
  res.type('text/xml').send(response.toString());
});

// ✅ Webhook to start audio stream
app.post('/gather-response', (req, res) => {
  const streamUrl = process.env.LOCAL_TEST === 'true'
    ? 'ws://localhost:2004/ws'
    : `wss://${process.env.RENDER_EXTERNAL_URL}/ws`;

  const response = new twiml.VoiceResponse();
  response.start().stream({ url: streamUrl });
  response.say('Streaming audio now');
  response.pause({ length: 15 });
  res.type('text/xml').send(response.toString());
});

// ✅ WebSocket handler
wss.on('connection', (ws) => {
  console.log('🔌 Twilio Media Stream connected');

  const dg = deepgram.listen.live({
    model: 'nova',
    language: 'en-US',
    punctuate: true
  });

  dg.on('open', () => console.log('✅ Deepgram connection opened'));
  dg.on('error', err => console.error('❌ Deepgram error:', err));
  dg.on('transcriptReceived', async (data) => {
    const text = data.channel.alternatives[0]?.transcript;
    if (text && text.trim() !== '') {
      console.log('📝 Transcript:', text);
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a helpful real estate assistant.' },
            { role: 'user', content: text }
          ]
        });
        const reply = response.choices[0].message.content;
        console.log('🤖 GPT Reply:', reply);
      } catch (err) {
        console.error('❌ GPT Error:', err.message);
      }
    }
  });

  ws.on('message', msg => {
    const data = JSON.parse(msg);
    if (data.event === 'media') {
      dg.send(Buffer.from(data.media.payload, 'base64'));
    }
    if (data.event === 'stop') {
      console.log('🛑 Media stream stopped');
      dg.finish();
    }
  });

  ws.on('close', () => {
    console.log('🔕 WebSocket closed');
    dg.finish();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Combined server running at http://0.0.0.0:${PORT}`);
});
