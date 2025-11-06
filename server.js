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
const { VoiceResponse } = twiml;

// ✅ Express Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ==========================================================
   1️⃣ Twilio Entry Point: Answer the Incoming Call
========================================================== */
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

/* ==========================================================
   2️⃣ Start Media Stream After Key Press
========================================================== */
app.post('/gather-response', (req, res) => {
  console.log('🎯 Key pressed, starting stream...');
  const response = new VoiceResponse();

  // Twilio will stream audio here:
  response.start().stream({
    url: 'wss://twilio-deepgram-et1q.onrender.com/ws'
  });

  response.say("You may begin speaking now.");
  response.pause({ length: 999 });
  res.type('text/xml').send(response.toString());
});

/* ==========================================================
   3️⃣ GPT Helper Function
========================================================== */
async function getGPTReply(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: 'system', content: 'You are Ava, a friendly real estate assistant.' },
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

/* ==========================================================
   4️⃣ WebSocket Server — Twilio → Deepgram → GPT
========================================================== */
wss.on('connection', ws => {
  console.log('🔌 Twilio Media Stream connected');

  const dgStream = deepgram.listen.live({
    model: 'nova',
    language: 'en-US',
    smart_format: true,
    punctuate: true,
    interim_results: true,
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    headers: {
      'Content-Type': 'audio/x-raw;encoding=mulaw;rate=8000;channels=1'
    }
  });

  dgStream.on('open', () => console.log("✅ Deepgram connected"));
  dgStream.on('error', err => console.error("❌ Deepgram error:", err));
  dgStream.on('close', () => console.log("🛑 Deepgram closed"));

  // ✅ Listen for real-time transcription events
  dgStream.on('transcription', async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;

    if (transcript && transcript.trim() !== '') {
      console.log('📝 Transcript:', transcript);
      const reply = await getGPTReply(transcript);
      console.log('🤖 GPT Reply:', reply);
    }
  });

  /* ==========================================================
     Incoming Twilio Audio Events
  ========================================================== */
  ws.on('message', msg => {
    let parsed;
    try {
      parsed = JSON.parse(msg);
    } catch (e) {
      console.warn('⚠️ Non-JSON message received. Ignored.');
      return;
    }

    if (parsed.event === 'start') {
      console.log(`▶️ Stream started | Call SID: ${parsed.start.callSid}`);
    }

    if (parsed.event === 'media') {
      const audio = Buffer.from(parsed.media.payload, 'base64');
      if (!audio || audio.length === 0) {
        console.warn('⚠ Received EMPTY audio chunk');
      } else {
        console.log(`📦 Received audio chunk | Size: ${audio.length} bytes`);
        dgStream.send(audio); // ✅ Send audio to Deepgram
      }
    }

    if (parsed.event === 'stop') {
      console.log('⛔ Stream stopped by Twilio');
      setTimeout(() => {
        dgStream.requestClose();
        console.log('🧹 Gracefully ended Deepgram session (via stop event)');
      }, 2000);
    }
  });

  ws.on('close', () => {
    console.log("🔒 WebSocket closed");
    setTimeout(() => {
      dgStream.requestClose();
      console.log('🧹 Gracefully ended Deepgram session (via socket close)');
    }, 2000);
  });
});

/* ==========================================================
   5️⃣ Start the Server
========================================================== */
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ Server listening on http://0.0.0.0:${PORT}`);
});