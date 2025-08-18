require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { twiml } = require('twilio');
const { createClient } = require('@deepgram/sdk');
const { OpenAI } = require('openai');

// ✅ Initialize AI clients
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
        { role: 'system', content: 'You are Ava, a friendly and professional real estate assistant. Give short, helpful replies.' },
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

// 📞 Twilio Webhook — handles the start of the call
app.post('/twilio-webhook', (req, res) => {
  console.log('📞 Incoming call: /twilio-webhook');

  const response = new twiml.VoiceResponse();
  response.gather({
    numDigits: 1,
    action: '/gather-response',
    method: 'POST'
  }).say('Press any key to begin.');

  res.type('text/xml').send(response.toString());
});

// 🎯 When digit is pressed, start Twilio <Stream> to /ws
app.post('/gather-response', (req, res) => {
  console.log('🎯 Key pressed. Starting stream...');

  const streamUrl = 'wss://twilio-deepgram-et1q.onrender.com/ws'; // ✅ Update to your Render WebSocket URL

  const response = new twiml.VoiceResponse();
  response.start().stream({ url: streamUrl });
  response.say('Hi, I’m Ava. How can I help you today?');
  response.pause({ length: 15 }); // Keep the line open

  res.type('text/xml').send(response.toString());
});

// 🔌 WebSocket → Deepgram → GPT
wss.on('connection', ws => {
  console.log('🔌 WebSocket connected');

  const dg = deepgram.listen.live({
    model: 'nova',
    language: 'en-US',
    smart_format: true,
    punctuate: true
  });

  dg.on('open', () => console.log('✅ Deepgram live transcription started'));
  dg.on('error', err => console.error('❌ Deepgram error:', err));
  dg.on('close', () => console.log('🛑 Deepgram connection closed'));

  dg.on('transcriptReceived', async (data) => {
    const text = data.channel?.alternatives?.[0]?.transcript;
    if (text && text.trim() !== '') {
      console.log('📝 Transcript:', text);
      const reply = await getChatGPTResponse(text);
      if (reply) {
        console.log('📢 GPT Response:', reply);
        // You could use Twilio <Say> here if enabling speech output
      }
    }
  });

  ws.on('message', msg => {
    const d = JSON.parse(msg);

    if (d.event === 'start') {
      console.log(`▶️ Streaming started | Call SID: ${d.start.callSid}`);
    }

    if (d.event === 'media') {
      const audio = Buffer.from(d.media.payload, 'base64');
      dg.send(audio);
    }

    if (d.event === 'stop') {
      console.log('⛔ Call ended.');
      dg.finish();
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
    dg.finish();
  });
});

// 🚀 Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});
