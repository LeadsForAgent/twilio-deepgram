const WebSocket = require('ws');
const { Deepgram } = require('@deepgram/sdk');
const { OpenAI } = require('openai');
require('dotenv').config();

const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const wss = new WebSocket.Server({ port: 10000 });

wss.on('connection', function connection(ws) {
  console.log('🔌 Twilio Media Stream connected');

  const dgConnection = deepgram.transcription.live(
    {
      model: 'nova-2',
      language: 'en-US',
      smart_format: true,
      punctuate: true,
      interim_results: false,
      encoding: 'mulaw',
      sample_rate: 16000,
      channels: 1
    },
    {
      'Content-Type': 'audio/x-raw;encoding=mulaw;rate=16000;channels=1'
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
  console.log('🧠 Full Deepgram transcript:', JSON.stringify(data, null, 2)); // ✅ DEBUG LOG
  const transcript = data.channel?.alternatives?.[0]?.transcript;


  if (transcript && transcript.trim() !== '') {
    console.log('📝 Transcript:', transcript);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are Ava...' },
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


  ws.on('message', function incoming(message) {
  console.log('🔁 Incoming WS message:', message);  // ✅ DEBUG LOG
  const data = JSON.parse(message);


    if (data.event === 'start') {
      console.log(`▶️ Streaming started | Call SID: ${data.start.callSid}`);
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
  console.log('🔒 WebSocket connection closed');
  setTimeout(() => {
    dgConnection.finish();
    console.log('🧹 Finished Deepgram connection after delay');
  }, 2000); // 2 seconds buffer
});
});
