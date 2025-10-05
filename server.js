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

const { VoiceResponse } = twiml;

// ✅ Entry Route — Twilio calls this first
app.post('/voice', (req, res) => {
  console.log('📞 Incoming call');
  const response = new VoiceResponse();
  const gather = response.gather({
    input: 'dtmf',
    action: '/gather-response',
    numDigits: 1,
    timeout: 5
  });
  gather.say("Hi, I'm Ava. Press any key to start talking.");
  res.type('text/xml').send(response.toString());
});

// ✅ After Keypress — Start Stream
app.post('/gather-response', (req, res) => {
  console.log('🎯 Key pressed, starting stream...');
  const response = new VoiceResponse();
  response.start().stream({
    url: 'wss://twilio-deepgram-et1q.onrender.com'
  });
  response.say("You may begin speaking now.");
  response.pause({ length: 999 });
  res.type('text/xml').send(response.toString());
});

// ✅ GPT Helper
async function getGPTReply(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: 'system', content: 'You are a helpful real estate assistant named Ava.' },
        { role: 'user', content: text }
      ],
      temperature: 0.7
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error("❌ GPT Error:", err.message);
    return "Sorry, I didn't get that.";
  }
}

// ✅ WebSocket → Deepgram → GPT
wss.on('connection', ws => {
  console.log('🔌 WebSocket connected');

  const dgStream = deepgram.listen.live({
    model: 'nova',
    language: 'en-US',
    smart_format: true,
    punctuate: true
  });

  dgStream.on('open', () => console.log("✅ Deepgram connected"));
  dgStream.on('error', err => console.error("❌ Deepgram error:", err));
  dgStream.on('close', () => console.log("🛑 Deepgram closed"));

  dgStream.on('transcriptReceived', async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (transcript && transcript.trim() !== '') {
      console.log('📝 Transcript:', transcript);
      const reply = await getGPTReply(transcript);
      console.log("🤖 GPT:", reply);
    }
  });

  ws.on('message', msg => {
    const parsed = JSON.parse(msg);

    if (parsed.event === 'start') {
      console.log(`▶️ Stream started | Call SID: ${parsed.start.callSid}`);
    }

    if (parsed.event === 'media') {
      const audio = Buffer.from(parsed.media.payload, 'base64');
      dgStream.send(audio);
    }

    if (parsed.event === 'stop') {
      console.log('⛔ Stream stopped');
      dgStream.requestClose();
    }
  });

  ws.on('close', () => {
    console.log("🔒 WebSocket closed");
    dgStream.requestClose();
  });
});

// ✅ Start Server
const PORT = process.env.PORT || 10000;
server.
(PORT, () => {
  console.log(`✅ Server listening on http://0.0.0.0:${PORT}`);
});
