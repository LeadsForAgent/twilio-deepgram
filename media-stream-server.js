// ✅ media-stream-server.js
const http = require('http');
const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');

const deepgram = createClient('YOUR_DEEPGRAM_API_KEY'); // Replace with your real Deepgram key

const server = http.createServer();
const wss = new WebSocket.Server({ server, path: '/ws' });

console.log("✅ WebSocket server running at ws://localhost:2004/ws");

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

server.listen(process.env.PORT || 2004, () => {
  console.log(`✅ WebSocket server listening at http://localhost:${process.env.PORT || 2004}/ws`);
});
