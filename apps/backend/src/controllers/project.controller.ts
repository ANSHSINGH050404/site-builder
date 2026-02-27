import type { Request, Response } from "express";
import { prisma } from "db";

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
      where: {
        id: id,
        userId,
      },
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
