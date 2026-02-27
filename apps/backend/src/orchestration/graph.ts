import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { getTools } from "../tools/tool.js";
import { plan_prompt } from "../prompts/plan_prompt.js";
import { llm } from "../config/llm.js";
import type { GraphState } from "../types/state.type.js";
import { StateAnnotation } from "../types/state.type.js";
import { MemorySaver } from "@langchain/langgraph";

const memorySaver = new MemorySaver();

export default async function createAgentGraph({
  projectId,
  model,
}: {
  projectId: string;
  model: ChatOpenAI;
}) {
  const tools = await getTools({ projectId });

  const modelWithTools = model.bindTools(tools);

  const plannerNode = async (state: GraphState) => {
    const userMessages = state.messages.filter(
      (msg) => msg instanceof HumanMessage
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

      // Try invoking with the model that has tools bound
      const response = await modelWithTools.invoke(state.messages);

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
            JSON.stringify(error.response, null, 2)
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
          "This appears to be a Google GenAI API response parsing error."
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
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    
    // Safety check: if we have too many messages, stop to prevent infinite loops
    if (state.messages.length > 200) {
      console.warn("Too many messages in state, stopping to prevent infinite loop");
      return "__end__";
    }
    
    // Check if the last message has tool calls
    if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
      return "tools";
    }
    
    // If no tool calls, this is a final response - end the graph
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