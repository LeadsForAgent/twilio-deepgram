console.log("Deepgram SDK Version:", require("@deepgram/sdk/package.json").version);
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

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ==========================================================
   1️⃣ Twilio Entry Point
========================================================== */
app.post('/voice', (req, res) => {
  console.log("📞 Incoming call");

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
  console.log("🎯 Key pressed — starting media stream");

  const response = new VoiceResponse();
  response.start().stream({
    url: 'wss://twilio-deepgram-et1q.onrender.com/ws'
  });

  response.say("You may begin speaking now.");
  response.pause({ length: 999 });

  res.type('text/xml').send(response.toString());
});

/* ==========================================================
   3️⃣ GPT Reply Handler
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
    console.error("❌ GPT Error:", err.message);
    return "Sorry, could you repeat that?";
  }
}

/* ==========================================================
   4️⃣ WebSocket: Twilio → Deepgram → GPT
========================================================== */
wss.on('connection', async (ws) => {
  console.log("🔌 Twilio Media Stream connected");

  /* ----------------------------------------------------------
     4A — Create Deepgram Live Stream Wrapper
  ---------------------------------------------------------- */
  const dgStream = deepgram.listen.live({
    model: "nova-3",
    language: "en-US",
    smart_format: true,
    punctuate: true,
    interim_results: true,
    encoding: "mulaw",
    sample_rate: 8000,
    channels: 1
  });

  console.log("🎤 Deepgram session created (awaiting WebSocket)…");

  /* ----------------------------------------------------------
     4B — Retrieve the REAL WebSocket
  ---------------------------------------------------------- */
  let dgSocket;
  try {
    dgSocket = await dgStream.getConnection();
    console.log("🟢 Deepgram WebSocket connection established");
  } catch (err) {
    console.error("❌ Failed to establish Deepgram WebSocket:", err);
    return;
  }

  /* ----------------------------------------------------------
     4C — Handle Deepgram Transcript Messages
  ---------------------------------------------------------- */
  dgSocket.on('message', async (msg) => {
    let data;
    try {
      data = JSON.parse(msg.toString());
    } catch (err) {
      console.error("❌ Invalid Deepgram JSON:", err);
      return;
    }

    if (data.type === "Results") {
      const transcript =
        data.channel?.alternatives?.[0]?.transcript?.trim() || "";

      if (transcript) {
        console.log("📝 Transcript:", transcript);

        const reply = await getGPTReply(transcript);
        console.log("🤖 GPT Reply:", reply);
      }
    }
  });

  dgSocket.on('close', () => console.log("🛑 Deepgram socket closed"));
  dgSocket.on('error', (err) => console.error("❌ Deepgram WS error:", err));

  /* ----------------------------------------------------------
     4D — Handle Twilio Audio Events
  ---------------------------------------------------------- */
  ws.on('message', (msg) => {
    let parsed;

    try {
      parsed = JSON.parse(msg);
    } catch {
      console.warn("⚠️ Non-JSON WS message ignored");
      return;
    }

    // Start event
    if (parsed.event === "start") {
      console.log(`▶️ Stream started | Call SID: ${parsed.start.callSid}`);
      return;
    }

    // Media event
    if (parsed.event === "media") {
      const audio = Buffer.from(parsed.media.payload, "base64");

      if (audio.length === 0) {
        console.warn("⚠️ Empty audio buffer");
        return;
      }

      console.log(`📦 Audio chunk | ${audio.length} bytes`);

      if (dgSocket?.readyState === WebSocket.OPEN) {
        dgSocket.send(audio);
      } else {
        console.warn("⚠️ Deepgram WS not open — audio dropped");
      }

      return;
    }

    // Stop event
    if (parsed.event === "stop") {
      console.log("⛔ Twilio STOP event");
      try {
        if (dgSocket) dgSocket.close();
      } catch (err) {
        console.error("❌ Error closing Deepgram socket:", err);
      }
    }
  });

  /* ----------------------------------------------------------
     4E — Twilio WebSocket Closed
  ---------------------------------------------------------- */
  ws.on('close', () => {
    console.log("🔒 Twilio WebSocket closed");
    try {
      if (dgSocket) dgSocket.close();
    } catch (err) {
      console.error("❌ Error closing Deepgram on WS close:", err);
    }
  });
});

/* ==========================================================
   5️⃣ Start Server
========================================================== */
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://0.0.0.0:${PORT}`);
});
