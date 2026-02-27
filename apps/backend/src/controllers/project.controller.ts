import type { Request, Response } from "express";
import { prisma } from "db";
import { HumanMessage } from "@langchain/core/messages";
import createAgentGraph from "../orchestration/graph";
import { llm } from "../config/llm";

export const createProject = async (req: Request, res: Response) => {
  try {
    const { title, initialPrompt } = req.body;
    const userId = req.user?.id;

    if (!title || !initialPrompt) {
      return res.status(400).json({ error: "All fields are required" });
    }
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const project = await prisma.project.create({
      data: { title, initialPrompt, userId },
    });
    return res.status(201).json({
      message: "Project created successfully",
      project,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getProjects = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const projects = await prisma.project.findMany({ where: { userId } });
    return res.status(200).json({
      message: "Projects fetched successfully",
      projects,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getProjectById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!id || typeof id !== "string") {
      return res.status(400).json({ error: "Project ID is required" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const project = await prisma.project.findFirst({
      where: { id, userId },
      include: { conversations: { orderBy: { createdAt: "asc" } } },
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.status(200).json(project);
  } catch (error) {
    console.error("Error fetching project:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const createProjectConversationChatMessage = async (
  req: Request,
  res: Response,
) => {
  try {
    const { projectId } = req.params;
    const { contents, type, toolCall, from } = req.body;
    const userId = req.user?.id;

    if (!projectId || !contents || !type || !from) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (Array.isArray(projectId)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId, userId },
    });
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    const conversation = await prisma.conversation.create({
      data: { projectId, contents, type, toolCall, from },
    });

    return res.status(200).json({
      message: "Project conversation chat message created successfully",
      conversation,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /projects/:projectId/chat
 * Triggers the AI agent with the user's message.
 * Streams back Server-Sent Events so the frontend can show real-time progress.
 */
export const chatWithAgent = async (req: Request, res: Response) => {
  const rawProjectId = req.params.projectId;
  const { message } = req.body;
  const userId = req.user?.id;

  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!rawProjectId || Array.isArray(rawProjectId))
    return res.status(400).json({ error: "Invalid project ID" });
  if (!message?.trim())
    return res.status(400).json({ error: "message is required" });

  const projectId: string = rawProjectId;

  const project = await prisma.project.findUnique({
    where: { id: projectId, userId },
  });
  if (!project) return res.status(404).json({ error: "Project not found" });

  // --- Save user message ---
  await prisma.conversation.create({
    data: { projectId, contents: message, type: "TEXT_MESSAGE", from: "USER" },
  });

  // --- Set up Server-Sent Events ---
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: object) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const graph = await createAgentGraph({ projectId, model: llm });

    const config = {
      configurable: { thread_id: projectId },
      recursionLimit: 100, // default is 25 — agent needs more steps on base template
    };
    const input = { messages: [new HumanMessage(message)], projectId };

    // Stream the graph execution
    const stream = await graph.stream(input, {
      ...config,
      streamMode: "values",
    });

    for await (const state of stream) {
      const messages: any[] = state.messages ?? [];
      const lastMsg = messages[messages.length - 1];
      if (!lastMsg) continue;

      const role = lastMsg.constructor.name;

      if (role === "AIMessage") {
        const content =
          typeof lastMsg.content === "string"
            ? lastMsg.content
            : JSON.stringify(lastMsg.content);

        // AI sent a text response → save + stream it
        if (content && !lastMsg.tool_calls?.length) {
          await prisma.conversation.create({
            data: {
              projectId,
              contents: content,
              type: "TEXT_MESSAGE",
              from: "AGENT",
            },
          });
          send("message", {
            from: "AGENT",
            type: "TEXT_MESSAGE",
            contents: content,
          });
        }

        // AI called a tool → stream the tool call event
        if (lastMsg.tool_calls?.length) {
          for (const tc of lastMsg.tool_calls) {
            send("tool_call", { tool: tc.name, args: tc.args });
          }
        }
      }

      // Check if the agent just started the dev server and returned a URL
      if (role === "ToolMessage") {
        const content = String(lastMsg.content);
        const urlMatch = content.match(/https:\/\/5173-[\w-]+\.e2b\.app/);
        if (urlMatch) {
          const previewUrl = urlMatch[0];
          await prisma.project.update({
            where: { id: projectId },
            data: { sandboxUrl: previewUrl },
          });
          send("preview_url", { url: previewUrl });
        }
      }
    }

    send("done", { message: "Agent finished" });
  } catch (err: any) {
    console.error("Agent error:", err);
    const errMsg = err?.message || "Agent encountered an error";
    await prisma.conversation.create({
      data: {
        projectId,
        contents: errMsg,
        type: "ERROR_MESSAGE",
        from: "AGENT",
      },
    });
    send("error", { message: errMsg });
  } finally {
    res.end();
  }
};
