import { Sandbox } from "@e2b/code-interpreter";
import { prisma } from "db";

const APP_ROOT = "/home/user/react-app";

export async function createSandbox(projectId: string): Promise<Sandbox> {
  let sandbox: Sandbox | null = null;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  // Try to reconnect to existing sandbox
  if (project.sandboxId) {
    try {
      sandbox = await Sandbox.connect(project.sandboxId);
    } catch (error) {
      console.error(
        "Error connecting to existing sandbox — will create a new one:",
        error,
      );
    }
  }

  // Create a fresh sandbox if we couldn't connect
  if (!sandbox) {
    const templateName =
      process.env.E2B_TEMPLATE || "site-builder-react-base-dev";
    try {
      sandbox = await Sandbox.create(templateName);
    } catch (e: any) {
      if (e?.message?.includes("not found")) {
        console.warn(
          `Template '${templateName}' not found — falling back to 'code-interpreter-v1'. Run 'bun run build-template-dev' to build your custom template.`,
        );
        sandbox = await Sandbox.create("code-interpreter-v1", {
          timeoutMs: 300_000,
        });
      } else {
        throw e;
      }
    }

    // Persist the new sandbox ID
    await prisma.project.update({
      where: { id: projectId },
      data: { sandboxId: sandbox.sandboxId },
    });

    // Restore any previously written files so the agent has full context
    const savedFiles = await prisma.projectFile.findMany({
      where: { projectId },
      select: { path: true, content: true },
    });

    if (savedFiles.length > 0) {
      console.log(`Restoring ${savedFiles.length} file(s) to new sandbox...`);
      for (const file of savedFiles) {
        try {
          const fullPath = `${APP_ROOT}/${file.path.replace(/^\/+/, "")}`;
          await sandbox.files.write(fullPath, file.content);
        } catch (err) {
          console.warn(`Failed to restore file ${file.path}:`, err);
        }
      }
    }
  }

  return sandbox;
}
