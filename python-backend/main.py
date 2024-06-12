import datetime
import time
from typing import Dict
import json
from fastapi import FastAPI, WebSocket, Request, Response
from fastapi.responses import StreamingResponse
from typing import Dict, List
from fastapi import FastAPI, WebSocket ,  WebSocketDisconnect
from groq import Groq
from prompts import AI_AGENT_PROMPT
import os
from openai import OpenAI
from dotenv import load_dotenv
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

print(GROQ_API_KEY)
print(OPENAI_API_KEY)


app = FastAPI()

# Initialize Groq client
client = Groq(api_key=GROQ_API_KEY)
client_oai = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# Dictionary to store message history
message_history: Dict[str, list] = {}

class GroqService:
    def __init__(self, message_history: Dict[str, List[dict]]):
        self.client = client  # Your Groq client instance
        self.message_history = message_history

    # def process_message(self, user_id: str, message: str):
    #     messages = self.message_history.get(user_id, [])

    #     # Add system and user message to the history
    #     messages.insert(0, {"role": "system", "content": AI_AGENT_PROMPT})
    #     messages.append({"role": "user", "content": message})

    #     print(messages)
    #     print("+=========================================+")
    #     start = time.time()
    #     # Create a new completion with the conversation history
    #     completion = self.client.chat.completions.create(
    #         model="llama3-70b-8192",
    #         messages=messages,
    #         temperature=1,
    #         max_tokens=1024,
    #         top_p=1,
    #         stream=False,
    #         stop=None,
            
    #     )

    #     final_response = completion.choices[0].message.content
    #     print(time.time()-start)
    #     messages.append({"role": "assistant", "content": final_response})
    #     self.message_history[user_id] = messages

    #     return final_response
    def process_message(self, user_id: str, message: str):
        messages = self.message_history.get(user_id, [])

        # Add system and user message to the history
        messages.insert(0, {"role": "system", "content": AI_AGENT_PROMPT})
        messages.append({"role": "user", "content": message})

        print(messages)
        print("+=========================================+")
        start = time.time()
        # Create a new completion with the conversation history
        completion = client.chat.completions.create(
                model="llama3-70b-8192",
                messages=messages,
                temperature=1,
                max_tokens=1024,
                top_p=1,
                stream=True,
                stop=None,
            )
        
        async def stream_response(completion, messages):
            buffer = ""
            final_response = ""
            for chunk in completion:
                if chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                    final_response += content
                    buffer += content
                    if len(buffer) > 50:  # Adjust this threshold if needed
                        print(time.time()-start)
                        print(f"Sending partial response: {buffer}")  # Debugging log
                        yield json.dumps({"partialResponse": buffer})
                        buffer = ""

            if buffer:
                print(f"Sending remaining content: {buffer}")  # Debugging log
                yield json.dumps({"partialResponse": buffer})
                
            messages.append({"role": "assistant", "content": final_response})
            self.message_history[user_id] = messages
            print(time.time() - start)
        return StreamingResponse(stream_response(completion, messages), media_type="text/event-stream")
    
groq_service = GroqService(message_history)

@app.post("/chat/{user_id}")
async def chat_endpoint(user_id: str, request: Request):
    message = await request.json()
    print("started")
    response = groq_service.process_message(user_id, message["content"])
    print("ended")
    return response



@app.post("/process_conversion/{user_id}")
async def process_conversion(user_id: str):
    # Assuming message_history is defined somewhere in your code
    if user_id not in message_history:
        return {"converted": "No conversation history found for the user."}
    
    else:
        conversation_history = message_history[user_id]

        # Join messages in conversation history as User:.... Assistant:....
        conversation = "\n\n".join([f"{message['role'].capitalize()}: {message['content']}" for message in conversation_history])

        prompt = f"Determine if the following conversation resulted in a successful conversion (customer agreeing to an in-person meeting) in JSON format as {{\"converted\": \"yes\"}} if yes, otherwise {{\"converted\": \"no\"}} :\n\n{conversation}"

        # Initialize the OpenAI client


        # Create a chat completion
        response = client_oai.chat.completions.create(
            model="gpt-3.5-turbo-1106",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=1024,
            n=1,
            stop=None,
            temperature=0,
            top_p=1,
        )

        return response.choices[0].message.content

        # use gpt-3.5-turbo-1106 in json mode to get the completion 
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
