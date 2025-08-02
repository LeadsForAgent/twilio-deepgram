// ✅ media-stream-server.js
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');

// 🔑 Replace with your real Deepgram key (consider using process.env for security)
const deepgram = createClient('YOUR_DEEPGRAM_API_KEY');

const server = http.createServer();
const wss = new WebSocket.Server({ server, path: '/ws' });

console.log("✅ WebSocket server initializing...");

wss.on('connection', function connection(ws) {
  console.log('🔌 Twilio Media Stream connected');

  const dgConnection = deepgram.listen.live({
    model: 'nova',
    language: 'en-US',
    smart_format: true,
    punctuate: true
  });

  dgConnection.on('open', () => {
    console.log('✅ Deepgram connection opened');
  });

  dgConnection.on('transcriptReceived', (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (transcript) {
      console.log('📝 Transcript:', transcript);
    }
  });

  dgConnection.on('error', (err) => {
    console.error('❌ Deepgram error:', err);
  });

  ws.on('message', function incoming(message) {
    const data = JSON.parse(message);

    if (data.event === 'start') {
      console.log('▶️ Streaming started for:', data.streamSid);
    }

    if (data.event === 'media') {
      const audio = Buffer.from(data.media.payload, 'base64');
      dgConnection.send(audio);
    }

    if (data.event === 'stop') {
      console.log('⛔ Streaming stopped');
      dgConnection.finish();
    }
  });

  ws.on('close', () => {
    console.log('🔒 WebSocket closed');
    dgConnection.finish();
  });
});

// ✅ Required for Render — use ONLY process.env.PORT
const PORT = process.env.PORT;
server.listen(PORT, () => {
  console.log(`✅ WebSocket server listening at http://0.0.0.0:${PORT}/ws`);
});
