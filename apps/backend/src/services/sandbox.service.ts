import { Sandbox } from "@e2b/code-interpreter";
import { prisma } from "../../../../packages/db";

export async function createSandbox(projectId: string): Promise<Sandbox> {
  let sandbox: Sandbox | null = null;
  let isNewSandbox = false;

  const project = await prisma.project.findUnique({
    where: {
      id: projectId,
    },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  if (project.sandboxId) {
    try {
      sandbox = await Sandbox.connect(project.sandboxId);
    } catch (error) {
      console.error("Error connecting to old sandbox:", error);
    }
  }
  if (!sandbox) {
    sandbox = await Sandbox.create("site-builder-react-base");
    project.sandboxId = sandbox.sandboxId;
    await prisma.project.update({
      where: { id: projectId },
      data: { sandboxId: sandbox.sandboxId },
    });
    isNewSandbox = true;
  }

  return sandbox;
}