require('dotenv').config();
require('colors');
const express = require('express');
const ExpressWs = require('express-ws');

const { GptService } = require('./services/gpt-service');
const { StreamService } = require('./services/stream-service');
const { TranscriptionService } = require('./services/transcription-service');
const { TextToSpeechService } = require('./services/tts-service');
const { exec } = require('child_process');

const app = express();
ExpressWs(app);

const PORT = process.env.PORT || 3000;

app.post('/incoming', (req, res) => {
  res.status(200);
  res.type('text/xml');
  res.end(`
  <Response>u
    <Connect>
      <Stream url="wss://${process.env.SERVER}/connection" />
    </Connect>
  </Response>
  `);
});

app.ws('/connection', (ws) => {
  ws.on('error', console.error);
  // Filled in from start message
  let streamSid;
  let callSid;
  let startTime = null;
  let prevEndTime = null;
  const gptService = new GptService();
  const streamService = new StreamService(ws);
  const transcriptionService = new TranscriptionService();
  const ttsService = new TextToSpeechService({});
  
  let marks = [];
  let interactionCount = 0;

  // Incoming from MediaStream
  ws.on('message', function message(data) {
    const msg = JSON.parse(data);
    if (msg.event === 'start') {
      streamSid = msg.start.streamSid;
      callSid = msg.start.callSid;
      streamService.setStreamSid(streamSid);
      gptService.setCallSid(callSid);
      console.log(`Twilio -> Starting Media Stream for ${streamSid}`.underline.red);
      ttsService.generate({partialResponseIndex: null, partialResponse: 'Hello, How are you doing today ?'}, 1);
    } else if (msg.event === 'media') {
      transcriptionService.send(msg.media.payload);
    } else if (msg.event === 'mark') {
      const label = msg.mark.name;
      console.log(`Twilio -> Audio completed mark (${msg.sequenceNumber}): ${label}`.red);
      marks = marks.filter(m => m !== msg.mark.name);
    } else if (msg.event === 'stop') {
      console.log(`Twilio -> Media stream ${streamSid} ended.`.underline.red);
    }
  });

  startTime = performance.now()
  prevEndTime = startTime
  
  transcriptionService.on('utterance', async (text) => {
    if(marks.length > 0 && text?.length > 5) {
      console.log('Twilio -> Interruption, Clearing stream'.red);
      ws.send(
        JSON.stringify({
          streamSid,
          event: 'clear',
        })
      );
    }
  });

  transcriptionService.on('transcription', async (text) => {
    if (!text) { return; }
    const currentTime = performance.now();
    console.log(`Interaction ${interactionCount} – STT -> GPT: ${text}`.yellow);
    console.log(`STT Latency: ${(currentTime - prevEndTime).toFixed(2)}ms`.cyan);
    prevEndTime = currentTime; // Store end time for next calculation
    gptService.completion(text, interactionCount);
    interactionCount += 1;
  });
  
  gptService.on('gptreply', async (gptReply, icount) => {
    const currentTime = performance.now();
    console.log(`Interaction ${icount}: GPT -> TTS: ${gptReply.partialResponse}`.green );
    console.log(`GPT Latency: ${(currentTime - prevEndTime).toFixed(2)}ms`.cyan);
    prevEndTime = currentTime;
    ttsService.generate(gptReply, icount);
  });

  ttsService.on('speech', (responseIndex, audio, label, icount) => {
    const currentTime = performance.now();
    console.log(`Interaction ${icount}: TTS -> TWILIO: ${label}`.blue);
    console.log(`TTS Latency: ${(currentTime - prevEndTime).toFixed(2)}ms`.cyan);
    prevEndTime = currentTime;
    streamService.buffer(responseIndex, audio);
  });

  // transcriptionService.on('transcription', async (text) => {
  //   if (!text) { return; }
  //   console.log(`Interaction ${interactionCount} – STT -> GPT: ${text}`.yellow);
  //   gptService.completion(text, interactionCount);
  //   interactionCount += 1;
  // });
  
  // gptService.on('gptreply', async (gptReply, icount) => {
  //   console.log(`Interaction ${icount}: GPT -> TTS: ${gptReply.partialResponse}`.green );
  //   ttsService.generate(gptReply, icount);
  // });

  // ttsService.on('speech', (responseIndex, audio, label, icount) => {
  //   console.log(`Interaction ${icount}: TTS -> TWILIO: ${label}`.blue);
  //   streamService.buffer(responseIndex, audio);
  // });

  // streamService.on('audiosent', (markLabel) => {
  //   marks.push(markLabel);
  // });
});

app.listen(PORT);
console.log(`Server running on port ${PORT}`);
