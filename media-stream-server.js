const WebSocket = require('ws');
const { Deepgram } = require('@deepgram/sdk');
const { OpenAI } = require('openai');
require('dotenv').config();

const dgClient = new Deepgram(process.env.DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const wss = new WebSocket.Server({ port: 10000 });

wss.on('connection', function connection(ws) {
  console.log('🔌 Twilio Media Stream connected');

  let dgConnectionReady = false;
  let audioBufferQueue = [];

  // ✅ Set up Deepgram live transcription with correct headers
  const dgConnection = dgClient.transcription.live({
    model: 'nova',
    language: 'en-US',
    smart_format: true,
    punctuate: true,
    interim_results: true,
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1
  }, {
    'Content-Type': 'audio/x-raw;encoding=mulaw;rate=8000;channels=1'
  });

  dgConnection.on('open', () => {
    console.log('✅ Deepgram connection opened');
    dgConnectionReady = true;

    // Flush buffered audio if any
    audioBufferQueue.forEach(audio => dgConnection.send(audio));
    audioBufferQueue = [];
  });

  dgConnection.on('error', (err) => {
    console.error('❌ Deepgram error:', err);
  });

  dgConnection.on('close', () => {
    console.log('🛑 Deepgram connection closed');
  });

  dgConnection.on('transcriptReceived', async (data) => {
    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (transcript && transcript.trim() !== '') {
      console.log('📝 Transcript:', transcript);

      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are Ava, a helpful assistant.' },
            { role: 'user', content: transcript }
          ],
          temperature: 0.7
        });

        const reply = response.choices?.[0]?.message?.content;
        console.log('🤖 GPT Reply:', reply || '❌ Empty GPT reply');

      } catch (err) {
        console.error('❌ GPT Error:', err.response?.data || err.message);
      }
    }
  });

  ws.on('message', function incoming(message) {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.warn('⚠️ Non-JSON message received. Ignored.');
      return;
    }

    if (data.event === 'start') {
      console.log(`▶️ Streaming started | Call SID: ${data.start.callSid}`);
    }

    if (data.event === 'media') {
  const audio = Buffer.from(data.media.payload, 'base64');

  if (!audio || audio.length === 0) {
    console.warn('⚠ Received EMPTY audio chunk');
  } else {
    console.log(`📦 Received audio chunk | Size: ${audio.length} bytes`);
  }

  // ✅ Send to Deepgram
  dgConnection.send(audio);

  // ✅ Write to local file for debugging (optional)
  audioStream.write(audio);
}


    if (data.event === 'stop') {
      console.log('⛔ Streaming stopped by Twilio');
      setTimeout(() => {
        dgConnection.finish();
        console.log('🧹 Gracefully ended Deepgram session (via stop event)');
      }, 2000);
    }
  });

  ws.on('close', () => {
    console.log('🔒 WebSocket connection closed');
    setTimeout(() => {
      dgConnection.finish();
      console.log('🧹 Gracefully ended Deepgram session (via socket close)');
    }, 2000);
  });
});
