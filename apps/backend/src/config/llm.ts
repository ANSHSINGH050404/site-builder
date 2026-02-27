import { ChatGoogle } from "@langchain/google";
import { HumanMessage } from "@langchain/core/messages";

const llm = new ChatGoogle({
  model: "gemini-3.1-pro-preview",
  apiKey: process.env.GOOGLE_API_KEY,
});

async function streamResponse() {
  // Call .stream() with your messages
  const stream = await llm.stream([
    new HumanMessage("Tell me a funny story about robots.")
  ]);

  // Iterate chunks as they arrive
  for await (const chunk of stream) {
    // Each `chunk` contains partial text as it's generated
    process.stdout.write(chunk.text || "");
  }
}

streamResponse();