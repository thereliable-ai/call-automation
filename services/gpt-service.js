require('colors');
const EventEmitter = require('events');
const OpenAI = require('openai');
const tools = require('../functions/function-manifest');

// Import all functions included in function manifest
// Note: the function name and file name must be the same
const availableFunctions = {};
tools.forEach((tool) => {
  let functionName = tool.function.name;
  availableFunctions[functionName] = require(`../functions/${functionName}`);
});

class GptService extends EventEmitter {
  constructor() {
    super();
    this.openai = new OpenAI();
    this.userContext = [
      { role: "system",content: `Your name is Rahul, and you are a highly capable AI assistant working as a sales lead generation representative for FirstCrown Hospitality, a reputable travel and hospitality service provider in India.Your goal is to engage with potential customers over the phone, explain FirstCrown's product/service offerings in detail, and convince them to schedule an in-person meeting where the final sale can be closed. As rahul, you have a warm and engaging personality. You are approachable, empathetic, and skilled at building rapport with customers. Your communication style is friendly and conversational, yet professional and knowledgeable. You have a keen ability to adapt your language and tone to match the customer's communication style, making them feel comfortable and understood.Throughout the conversation, you maintain a supportive and helpful demeanor, focusing on providing comprehensive information rather than aggressive selling tactics. You are prepared to address objections or hesitations by offering incentives such as discounts or gifts, but you do so in a genuine and transparent manner, never resorting to pushy or manipulative tactics. Adhere to the following constraints: Keep the cost per successful lead (customer agreeing to an in-person meeting) under 300 INR. Prevent misuse by validating the caller's identity and ensuring compliance with relevant telemarketing regulations (e.g., TRAI rules).
The conversation should progress as follows: 1. Greet the customer warmly and introduce yourself as rahul, a representative of FirstCrown Hospitality. 2. Try to understand about client , his name and other details understanding his needs first. 3. Provide a brief overview of FirstCrown's product/service offering, highlighting the unique value proposition and benefits. 4. Ask open-ended questions to gauge the customer's interests and tailor your pitch accordingly, showcasing your attentive and personalized approach. 5. Address any concerns or objections raised by the customer, offering incentives or additional information as needed, while maintaining a supportive and understanding tone. 6. If the customer seems interested, propose an in-person meeting at a specific location and date (e.g., Hyatt Hotel, New Delhi, on May 19th) to further discuss the offering and potentially close the deal, emphasizing the value of a face-to-face interaction. 7. If the customer declines the in-person meeting, politely thank them for their time and end the conversation in a gracious manner, leaving the door open for future engagement.
Remember, your primary objective as rahul is to secure the customer's commitment to attend the in-person meeting or online meeting, not to close the sale directly over the phone. Maintain professionalism while allowing your warm and approachable personality to shine through. Adapt to the customer's communication style, and continuously refine your approach based on the outcomes of previous conversations, always striving to provide an exceptional customer experience. You should respond in short sentences but not too short sentences as well. Your reply must adhere assuming this conversation is going on a phone call. You are speaking with`},
    { 'role': 'assistant', 'content': 'Hello, How are you doing today ?' },
    ],
    this.partialResponseIndex = 0;
  }

  // Add the callSid to the chat context in case
  // ChatGPT decides to transfer the call.
  setCallSid (callSid) {
    this.userContext.push({ 'role': 'system', 'content': `callSid: ${callSid}` });
  }

  validateFunctionArgs (args) {
    try {
      return JSON.parse(args);
    } catch (error) {
      console.log('Warning: Double function arguments returned by OpenAI:', args);
      // Seeing an error where sometimes we have two sets of args
      if (args.indexOf('{') != args.lastIndexOf('{')) {
        return JSON.parse(args.substring(args.indexOf(''), args.indexOf('}') + 1));
      }
    }
  }

  updateUserContext(name, role, text) {
    if (name !== 'user') {
      this.userContext.push({ 'role': role, 'name': name, 'content': text });
    } else {
      this.userContext.push({ 'role': role, 'content': text });
    }
  }

  async completion(text, interactionCount, role = 'user', name = 'user') {
    this.updateUserContext(name, role, text);

    // Step 1: Send user transcription to Chat GPT
    const stream = await this.openai.chat.completions.create({
      model: 'gpt-4-1106-preview',
      messages: this.userContext,
      tools: tools,
      stream: true,
    });

    let completeResponse = '';
    let partialResponse = '';
    let functionName = '';
    let functionArgs = '';
    let finishReason = '';

    function collectToolInformation(deltas) {
      let name = deltas.tool_calls[0]?.function?.name || '';
      if (name != '') {
        functionName = name;
      }
      let args = deltas.tool_calls[0]?.function?.arguments || '';
      if (args != '') {
        // args are streamed as JSON string so we need to concatenate all chunks
        functionArgs += args;
      }
    }

    for await (const chunk of stream) {
      let content = chunk.choices[0]?.delta?.content || '';
      let deltas = chunk.choices[0].delta;
      finishReason = chunk.choices[0].finish_reason;

      // Step 2: check if GPT wanted to call a function
      if (deltas.tool_calls) {
        // Step 3: Collect the tokens containing function data
        collectToolInformation(deltas);
      }

      // need to call function on behalf of Chat GPT with the arguments it parsed from the conversation
      if (finishReason === 'tool_calls') {
        // parse JSON string of args into JSON object

        const functionToCall = availableFunctions[functionName];
        const validatedArgs = this.validateFunctionArgs(functionArgs);
        
        // Say a pre-configured message from the function manifest
        // before running the function.
        const toolData = tools.find(tool => tool.function.name === functionName);
        const say = toolData.function.say;

        this.emit('gptreply', {
          partialResponseIndex: null,
          partialResponse: say
        }, interactionCount);

        let functionResponse = await functionToCall(validatedArgs);

        // Step 4: send the info on the function call and function response to GPT
        this.updateUserContext(functionName, 'function', functionResponse);
        
        // call the completion function again but pass in the function response to have OpenAI generate a new assistant response
        await this.completion(functionResponse, interactionCount, 'function', functionName);
      } else {
        // We use completeResponse for userContext
        completeResponse += content;
        // We use partialResponse to provide a chunk for TTS
        partialResponse += content;
        // Emit last partial response and add complete response to userContext
        if (content.trim().slice(-1) === '•' || finishReason === 'stop') {
          const gptReply = { 
            partialResponseIndex: this.partialResponseIndex,
            partialResponse
          };

          this.emit('gptreply', gptReply, interactionCount);
          this.partialResponseIndex++;
          partialResponse = '';
        }
      }
    }
    this.userContext.push({'role': 'assistant', 'content': completeResponse});
    console.log(`GPT -> user context length: ${this.userContext.length}`.green);
  }
}

module.exports = { GptService };
