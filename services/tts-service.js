const EventEmitter = require('events');
const { Buffer } = require('node:buffer');
const fetch = require('node-fetch');
const fs = require("fs")

class TextToSpeechService extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.config.voiceId ||= process.env.VOICE_ID || "aura-asteria-en"; 
    this.nextExpectedIndex = 0;
    this.speechBuffer = {};
  }

  async generate(gptReply, interactionCount) {
    const { partialResponseIndex, partialResponse } = gptReply;

    if (!partialResponse) { return; }

    try {
      const url = 'https://api.deepgram.com/v1/speak?model=aura-angus-en&encoding=mulaw'; 
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}` 
        },
        body: JSON.stringify({
          text: partialResponse
        })
      };

      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`Deepgram TTS request failed with status ${response.status}: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBase64 = Buffer.from(arrayBuffer).toString('base64');
      fs.writeFileSync("output.wav", Buffer.from(arrayBuffer));
      this.emit('speech', partialResponseIndex, audioBase64, partialResponse, interactionCount);
    } catch (err) {
      console.error('Error occurred in TextToSpeech service:', err);
      this.emit('error', err); // Emit error for handling
    }
  }
}

module.exports = { TextToSpeechService };
