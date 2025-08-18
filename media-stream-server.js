require('dotenv').config();
const http = require('http');
const WebSocket = require('ws');
const { Deepgram } = require('@deepgram/sdk');
const OpenAI = require('openai');

// ✅ Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Initialize Deepgram WebSocket client
const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);

// ✅ Create HTTP server (needed for Render health checks)
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('✅ WebSocket server running.');
  } else {
    res.writeHead(404);
    res.end();
  }
});

// ✅ Attach WebSocket server at /ws
const wss = new WebSocket.Server({ server, path: '/ws' });

console.log("✅ WebSocket server initializing...");

wss.on('connection', function connection(ws) {
  console.log('🔌 Twilio Media Stream connected');

  const dgConnection = deepgram.transcription.live({
    model: 'nova',
    language: 'en-US',
    smart_format: true,
    punctuate: true
  });

  dgConnection.on('open', () => {
    console.log('✅ Deepgram connection opened');
  });

  dgConnection.on('error', (err) => {
    console.error('❌ Deepgram error:', err);
  });

  dgConnection.on('close', () => {
    console.log('🛑 Deepgram connection closed');
  });

  // ✅ Transcript → GPT
  dgConnection.on('transcriptReceived', async (data) => {
  const transcript = data.channel?.alternatives?.[0]?.transcript;

  if (transcript && transcript.trim() !== '') {
    console.log('📝 Transcript:', transcript);

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are Ava, a friendly and professional real estate assistant. Give short, helpful replies.',
            },
            {
              role: 'user',
              content: transcript
            }
          ],
          temperature: 0.7
        });

        const reply = response.choices[0].message.content;
        console.log('🤖 GPT Reply:', reply);
      } catch (err) {
        console.error('❌ GPT Error:', err.message);
      }
    }
  });

  // ✅ Incoming audio from Twilio Media Stream
ws.on('message', function incoming(message) {
  const data = JSON.parse(message);

  if (data.event === 'start') {
    console.log(`▶️ Streaming started | Call SID: ${data.start.callSid}`);
  }

  if (data.event === 'media') {
    const audio = Buffer.from(data.media.payload, 'base64');
    console.log(`🎧 Received audio packet: ${audio.length} bytes`);
    dgConnection.send(audio);
  }

  if (data.event === 'stop') {
    console.log('⛔ Streaming stopped');
    dgConnection.finish();
  }
});

ws.on('close', () => {
  console.log('🔒 WebSocket connection closed');
  dgConnection.finish();
});


// ✅ Start the server
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ WebSocket server listening on http://0.0.0.0:${PORT}/ws`);
});
