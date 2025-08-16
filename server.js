require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { twiml } = require('twilio');
const { createClient } = require('@deepgram/sdk');
const { OpenAI } = require('openai');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// 🧠 GPT-3.5 call
async function getChatGPTResponse(text) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful real estate assistant.' },
        { role: 'user', content: text }
      ]
    });

    const reply = response.choices[0].message.content.trim();
    console.log('🤖 GPT reply:', reply);
    return reply;
  } catch (err) {
    console.error('❌ GPT Error:', err.message);
    return null;
  }
}

// 📡 Twilio Webhook
app.post('/twilio-webhook', (req, res) => {
  console.log('📞 Incoming call: /twilio-webhook');
  const response = new twiml.VoiceResponse();
  response.gather({ numDigits: 1, action: '/gather-response', method: 'POST' })
    .say('Press any key to begin.');
  res.type('text/xml').send(response.toString());
});

// 📲 On keypress, start media stream
app.post('/gather-response', (req, res) => {
  console.log('🎯 Key pressed. Starting stream...');
  const streamUrl = process.env.LOCAL_TEST === 'true'
    ? 'ws://localhost:2004/ws'
    : `wss://${process.env.RENDER_EXTERNAL_URL}/ws`;

  const response = new twiml.VoiceResponse();
  response.start().stream({ url: streamUrl });
  response.say('You may speak now.');
  response.pause({ length: 15 }); // Keep call open
  res.type('text/xml').send(response.toString());
});

// 🔌 WebSocket connection handler
wss.on('connection', ws => {
  console.log('🔌 WebSocket connected');

  const dg = deepgram.listen.live({
    model: 'nova',
    language: 'en-US',
    punctuate: true
  });

  dg.on('open', () => console.log('✅ Deepgram live transcription started'));
  dg.on('error', err => console.error('❌ Deepgram error:', err));
  dg.on('close', () => console.log('🛑 Deepgram closed'));

  dg.on('transcriptReceived', async (data) => {
    try {
      const text = data.channel.alternatives[0]?.transcript;
      if (text && text.trim() !== '') {
        console.log('📝 Transcript:', text);
        const reply = await getChatGPTResponse(text);
        if (reply) {
          console.log('📢 Response to user:', reply);
          // Optional: use Twilio to say this back to user via a secondary call
        }
      }
    } catch (err) {
      console.error('❌ Transcript processing error:', err.message);
    }
  });

  ws.on('message', msg => {
    const d = JSON.parse(msg);
    if (d.event === 'media') {
      dg.send(Buffer.from(d.media.payload, 'base64'));
    }
    if (d.event === 'stop') {
      console.log('🛑 Call stopped.');
      dg.finish();
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket closed');
    dg.finish();
  });
});

// 🚀 Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
