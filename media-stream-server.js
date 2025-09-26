const WebSocket = require('ws');
const { createClient } = require('@deepgram/sdk');
const { OpenAI } = require('openai');
const fs = require('fs');
require('dotenv').config();

// ✅ Initialize Deepgram
const dgClient = createClient(process.env.DEEPGRAM_API_KEY);

// ✅ Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ✅ Setup raw audio logging (for debugging)
const audioStream = fs.createWriteStream('audio.raw');

// ✅ WebSocket Server
const wss = new WebSocket.Server({ port: 10000 });

wss.on('connection', function connection(ws) {
  console.log('🔌 Twilio Media Stream connected');

  const dgConnection = dgClient.listen.live(
    {
      model: 'nova',
      language: 'en-US',
      smart_format: true,
      punctuate: true,
      interim_results: true,
      encoding: 'mulaw',
      sample_rate: 8000,
      channels: 1
    },
    {
      'Content-Type': 'audio/x-raw;encoding=mulaw;rate=8000;channels=1'
    }
  );

  dgConnection.on('open', () => {
    console.log('✅ Deepgram connection opened');
  });

  dgConnection.on('error', (err) => {
    console.error('❌ Deepgram error:', err);
  });

  dgConnection.on('close', () => {
    console.log('🛑 Deepgram connection closed');
  });

  dgConnection.on('transcriptReceived', async (data) => {
    console.log('🧠 Full Deepgram transcript:', JSON.stringify(data, null, 2));

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
    } else {
      console.log('📭 No transcript received or empty input');
    }
  });

  let chunkCount = 0;

  ws.on('message', function incoming(message) {
    const data = JSON.parse(message);

    if (data.event === 'start') {
      console.log(`▶️ Streaming started | Call SID: ${data.start.callSid}`);
    }

    if (data.event === 'media') {
      const audio = Buffer.from(data.media.payload, 'base64');
      chunkCount++;

      console.log(`📦 Received audio chunk #${chunkCount} | Size: ${audio.length} bytes`);

      // ✅ Send audio to Deepgram
      dgConnection.send(audio);

      // ✅ Also write audio to raw file for debugging
      audioStream.write(audio);
    }

    if (data.event === 'stop') {
      console.log('⛔ Streaming stopped by Twilio');
      setTimeout(() => {
        dgConnection.requestClose();
        console.log('🧹 Gracefully ended Deepgram session (via stop event)');
      }, 2000);
    }
  });

  ws.on('close', () => {
    console.log('🔒 WebSocket connection closed');
    setTimeout(() => {
      dgConnection.requestClose();
      console.log('🧹 Gracefully ended Deepgram session (via socket close)');
    }, 2000);
  });
});
