import { Sandbox } from "@e2b/code-interpreter";
import { prisma } from "db";

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
    // Use the custom template if built, otherwise fall back to E2B base
    const templateName =
      process.env.E2B_TEMPLATE || "site-builder-react-base-dev";
    try {
      sandbox = await Sandbox.create(templateName);
    } catch (e: any) {
      if (e?.message?.includes("not found")) {
        console.warn(
          `Template '${templateName}' not found — falling back to 'code-interpreter-v1'. Run 'bun run build-template-dev' to build your custom template.`,
        );
        // code-interpreter-v1 has Node.js + npm pre-installed
        sandbox = await Sandbox.create("code-interpreter-v1", {
          timeoutMs: 300_000,
        });
      } else {
        throw e;
      }
    }
    project.sandboxId = sandbox.sandboxId;
    await prisma.project.update({
      where: { id: projectId },
      data: { sandboxId: sandbox.sandboxId },
    });
    isNewSandbox = true;
  }

  return sandbox;
}
