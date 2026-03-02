import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  BaseMessage,
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

/**
 * Maximum number of AI↔Tool round-trips before we force-stop.
 * Each round = 1 AIMessage + 1 ToolMessage = 2 messages.
 * 20 rounds = 40 messages, which is more than enough for most tasks.
 */
const MAX_TOOL_ROUNDS = 20;

/**
 * When the conversation history grows large, we only send the most recent
 * messages to the LLM to avoid blowing the context window and to keep
 * the model focused on the current task.
 *
 * We always preserve:
 *   - The first HumanMessage (original user request) at the top
 *   - Up to RECENT_WINDOW of the most recent messages
 */
const RECENT_WINDOW = 16;

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

  // ────────────────────────────────────────────────────────────
  // Planner node — generates a concise step-by-step plan and
  // injects it as a SystemMessage so the agent can follow it.
  // ────────────────────────────────────────────────────────────
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

    // Prepend the plan as a SystemMessage so the agent sees it first
    const planMsg = new SystemMessage(
      `Execution plan — follow these steps in order:\n${planContent}`,
    );

    console.log(`[Planner] Generated ${planSteps.length} step plan`);
    return {
      plan: planSteps,
      messages: [planMsg],
    };
  };

  // ────────────────────────────────────────────────────────────
  // Agent node — sends history to the LLM, gets back
  // either tool calls or a final text response.
  // ────────────────────────────────────────────────────────────
  const agentNode = async (state: GraphState) => {
    if (!state.messages || state.messages.length === 0) {
      throw new Error("No messages provided to agentNode");
    }

    const roundsUsed = Math.floor(
      state.messages.filter((m) => m instanceof AIMessage).length,
    );

    console.log(
      `[Agent] Round ${roundsUsed + 1}/${MAX_TOOL_ROUNDS} | Sending ${
        state.messages.length
      } messages to model...`,
    );

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

    if (response.tool_calls && response.tool_calls.length > 0) {
      const toolNames = response.tool_calls.map((t) => t.name).join(", ");
      console.log(`[Agent] Returning tool calls: ${toolNames}`);
    } else {
      console.log(`[Agent] Returning text response (no tools)`);
    }

    return { messages: [response] };
  };

  const toolNode = new ToolNode(tools);

  // ────────────────────────────────────────────────────────────
  // Router — decides whether to call tools or stop
  // ────────────────────────────────────────────────────────────
  const shouldContinue = (state: GraphState) => {
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1] as AIMessage;

    // Count completed AI→Tool rounds
    const aiMessages = messages.filter((m) => m instanceof AIMessage);
    if (aiMessages.length >= MAX_TOOL_ROUNDS) {
      console.warn(
        `Agent reached ${MAX_TOOL_ROUNDS} tool rounds — stopping to prevent infinite loop`,
      );
      return "__end__";
    }

    // If the last ToolMessage contains a preview URL, the job is done
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.constructor?.name === "ToolMessage") {
      const content = String(lastMsg.content);
      if (content.match(/https:\/\/5173-[\w-]+\.e2b\.app/)) {
        console.log("Dev server started — stopping agent loop");
        return "__end__";
      }
    }

    // Keep going if the AI requested tool calls
    if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
      return "tools";
    }

    // No tool calls → AI sent a final text reply → done
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

  // NOTE: No MemorySaver — we don't persist graph state across HTTP requests.
  // Conversations are stored in PostgreSQL via the DB and passed in as the
  // initial HumanMessage for each chat call. Sharing a MemorySaver across
  // requests caused messages to accumulate from previous runs and immediately
  // trigger the hard stop limit on subsequent chats.
  return workflow.compile();
}
