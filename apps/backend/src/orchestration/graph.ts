import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph } from "@langchain/langgraph";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getTools } from "../tools/tools";
import { plan_prompt } from "../prompts/plan_prompt";
import { system_message } from "../prompts/system_message";
import { llm } from "../config/llm";
import type { GraphState } from "../types/state.type";
import { StateAnnotation } from "../types/state.type";
import { MemorySaver } from "@langchain/langgraph";

const memorySaver = new MemorySaver();

export default async function createAgentGraph({
  projectId,
  model,
}: {
  projectId: string;
  model: BaseChatModel;
}) {
  const tools = await getTools({ projectId });

  if (!model.bindTools) {
    throw new Error("Model does not support tool calling");
  }

  const modelWithTools = model.bindTools(tools);

  const plannerNode = async (state: GraphState) => {
    const userMessages = state.messages.filter(
      (msg) => msg instanceof HumanMessage,
    );
    const userRequest = userMessages
      .map((msg) => {
        const content = msg.content;
        return typeof content === "string" ? content : String(content);
      })
      .join("\n");

    const prompt = userRequest
      ? `${plan_prompt}\n\nUser's request: ${userRequest}`
      : plan_prompt;

    const response = await llm.invoke([new HumanMessage(prompt)]);

    const planContent =
      typeof response.content === "string"
        ? response.content
        : String(response.content);
    const planSteps = planContent
      .split(/\n+/)
      .map((line) => line.replace(/^[\d\-\*•]\s*/, "").trim())
      .filter((line) => line.length > 0);
    return { plan: planSteps };
  };

  const agentNode = async (state: GraphState) => {
    try {
      // Log messages being sent for debugging
      console.log("agentNode: Invoking model with messages:", {
        count: state.messages.length,
        types: state.messages.map((msg) => msg.constructor.name),
      });

      // Ensure we have valid messages
      if (!state.messages || state.messages.length === 0) {
        throw new Error("No messages provided to agentNode");
      }

      // Prepend system message so the model always has its instructions
      const systemMsg = new SystemMessage(
        system_message.replace("{{context}}", ""),
      );
      const response = await modelWithTools.invoke([
        systemMsg,
        ...state.messages,
      ]);

      if (!response) {
        throw new Error("Model returned undefined response");
      }

      return { messages: [response] };
    } catch (error: any) {
      console.error("Error in agentNode:", error);
      console.error("Error details:", {
        message: error?.message,
        response: error?.response,
        cause: error?.cause,
        name: error?.name,
      });

      // Check if it's an API error with more details
      if (error?.response) {
        try {
          console.error(
            "API Response:",
            JSON.stringify(error.response, null, 2),
          );
        } catch (e) {
          console.error("Could not stringify API response");
        }
      }

      // Check for specific Google API error patterns
      if (
        error?.message?.includes("reduce") ||
        error?.message?.includes("parts")
      ) {
        console.error(
          "This appears to be a Google GenAI API response parsing error.",
        );
        console.error("Possible causes:");
        console.error("  1. Invalid API key");
        console.error("  2. Invalid model name");
        console.error("  3. API response format mismatch");
        console.error("  4. Rate limiting or quota exceeded");
      }

      throw error;
    }
  };

  const toolNode = new ToolNode(tools);

  const shouldContinue = (state: GraphState) => {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1] as AIMessage;

    // Hard stop — too many iterations
    if (messages.length > 60) {
      console.warn("Message limit reached — stopping agent loop");
      return "__end__";
    }

    // If the last ToolMessage contains a preview URL, the job is done — stop
    const prevMessage = messages[messages.length - 1];
    if (prevMessage?.constructor?.name === "ToolMessage") {
      const content = String(prevMessage.content);
      if (content.match(/https:\/\/5173-[\w-]+\.e2b\.app/)) {
        console.log("Dev server started successfully — agent stopping");
        return "__end__";
      }
    }

    // Check if the last AI message has tool calls — if so, keep going
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return "tools";
    }

    // No tool calls → AI gave a final text response → done
    return "__end__";
  };

  const workflow = new StateGraph(StateAnnotation)
    .addNode("planner", plannerNode)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)

    .addEdge("__start__", "planner")
    .addEdge("planner", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

  return workflow.compile({ checkpointer: memorySaver });
}
