import { ChatGoogle } from "@langchain/google";

export const llm = new ChatGoogle({
  model: "gemini-2.0-flash", // gemini-3.1-pro-preview doesn't exist yet; use a valid model
  apiKey: process.env.GOOGLE_API_KEY,
});
