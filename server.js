require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { twiml } = require('twilio');
const { createClient, LiveTranscriptionEvents } = require('@deepgram/sdk');
const { OpenAI } = require('openai');

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });
const { VoiceResponse } = twiml;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ==========================================================
   1️⃣ Twilio Call Entry
========================================================== */
app.post('/voice', (req, res) => {
  console.log("📞 Incoming call");

  const response = new VoiceResponse();
  const gather = response.gather({
    input: 'dtmf',
    action: '/gather-response',
    numDigits: 1
  });

  gather.say("Hi, I'm Ava. Press any key to start talking.");

  res.type('text/xml').send(response.toString());
});

/* ==========================================================
   2️⃣ After Keypress
========================================================== */
app.post('/gather-response', (req, res) => {
  console.log("🎯 Key pressed, starting stream...");

  const response = new VoiceResponse();
  response.start().stream({
    url: 'wss://twilio-deepgram-et1q.onrender.com/ws'
  });

  response.say("You may begin speaking now.");
  response.pause({ length: 999 });

  res.type('text/xml').send(response.toString());
});

/* ==========================================================
   3️⃣ GPT Helper
========================================================== */
async function getGPTReply(text) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are Ava, a friendly real estate assistant." },
        { role: "user", content: text }
      ]
    });

    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error("❌ GPT Error:", err);
    return "Sorry, I didn't get that.";
  }
}

/* ==========================================================
   4️⃣ WebSocket Server (Twilio → Deepgram → GPT)
========================================================== */
wss.on('connection', (ws) => {
  console.log("🔌 Twilio Media Stream connected");

  // Create Live Deepgram Stream (4.11.2 syntax)
  const dg = deepgram.listen.live({
    model: "nova",
    language: "en-US",
    smart_format: true,
    punctuate: true,
    interim_results: true,
    encoding: "mulaw",
    sample_rate: 8000,
    channels: 1
  });

  const audioQueue = [];
  let dgReady = false;

  // Deepgram Ready
  dg.on(LiveTranscriptionEvents.Open, () => {
    console.log("🌐 Deepgram connected");
    dgReady = true;

    // Flush audio received early
    while (audioQueue.length > 0) {
      dg.send(audioQueue.shift());
    }
  });

  // Receive transcripts
  dg.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;

    if (transcript && transcript.trim() !== "") {
      console.log("📝 Transcript:", transcript);

      const reply = await getGPTReply(transcript);
      console.log("🤖 GPT Reply:", reply);
    }
  });

  // Deepgram errors
  dg.on(LiveTranscriptionEvents.Error, (err) => {
    console.error("❌ Deepgram error:", err);
  });

  // Twilio incoming media
  ws.on('message', (msg) => {
    const parsed = JSON.parse(msg);

    if (parsed.event === 'media') {
      const audio = Buffer.from(parsed.media.payload, 'base64');

      if (dgReady) {
        dg.send(audio);
      } else {
        audioQueue.push(audio);
      }
    }

    if (parsed.event === 'stop') {
      console.log("⛔ Twilio stream stopped");
      dg.finish();
    }
  });

  ws.on('close', () => {
    console.log("🔒 WebSocket closed");
    dg.finish();
  });
});

/* ==========================================================
   Server Start
========================================================== */
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
});
