import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";
import { prisma } from "../../../../packages/db";
import { Exa } from "exa-js";
import { createSandbox } from "../services/sandbox.service.js";

const APP_ROOT = "/home/user/react-app";

const exaClient = new Exa(process.env.EXASEARCH_API_KEY || "");

export async function getSandbox(projectId: string): Promise<Sandbox> {
  return await createSandbox(projectId);
}

export async function getTools({
  projectId,
}: {
  projectId: string;
}): Promise<StructuredToolInterface[]> {
  const sandbox = await getSandbox(projectId);

  const tools: StructuredToolInterface[] = [
    createAddDependencyTool(sandbox),
    createWriteFileTool(sandbox, projectId),
    createReadFileTool(sandbox),
    createDeleteFileTool(sandbox, projectId),
    createExecuteCommandTool(sandbox),
    createRenameFileTool(sandbox, projectId),
    createListDirectoriesTool(sandbox),
    createTestBuildTool(sandbox),
    createWriteMultipleFilesTool(sandbox, projectId),
    createStartDevServerTool(sandbox),
    createSearchTool(),
  ];

  return tools;
}

function createAddDependencyTool(sandbox: Sandbox) {
  return tool(
    async ({ pkg }) => {
      try {
        await sandbox.commands.run(`npm install ${pkg}`);
        return `Successfully installed ${pkg}`;
      } catch (e) {
        return `Failed to install dependency ${pkg}: ${e}`;
      }
    },
    {
      name: "add_dependency",
      description: "Install an npm package dependency",
      schema: z.object({
        pkg: z
          .string()
          .describe("The npm package to install, e.g. react-icons"),
      }),
    }
  );
}

function createWriteFileTool(sandbox: Sandbox, projectId: string) {
  return tool(
    async ({ filepath, content }) => {
      const fullPath = `${APP_ROOT}/${filepath.replace(/^\/+/, "")}`;

      try {
        await sandbox.files.write(fullPath, content);

        await prisma.projectFile.upsert({
          where: { projectId_path: { projectId, path: filepath } },
          create: {
            projectId,
            path: filepath,
            content,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          update: {
            content,
            updatedAt: new Date(),
          },
        });

        return `File ${filepath} created successfully.`;
      } catch (e) {
        return `Failed to create file ${filepath}: ${e}`;
      }
    },
    {
      name: "write_file",
      description: "Create or overwrite a file with the given content",
      schema: z.object({
        filepath: z.string().describe("The file path, e.g. src/App.tsx"),
        content: z.string().describe("The content to write to the file"),
      }),
    }
  );
}

function createReadFileTool(sandbox: Sandbox) {
  return tool(
    async ({ filepath }) => {
      const fullPath = `${APP_ROOT}/${filepath.replace(/^\/+/, "")}`;

      try {
        const content = await sandbox.files.read(fullPath);

        return `Content of ${filepath}:\n${content}`;
      } catch (e) {
        return `Failed to read file ${filepath}: ${e}`;
      }
    },
    {
      name: "read_file",
      description: "Read a file and return its contents",
      schema: z.object({
        filepath: z.string().describe("Path like src/App.tsx or package.json"),
      }),
    }
  );
}

function createDeleteFileTool(sandbox: Sandbox, projectId: string) {
  return tool(
    async ({ filepath }) => {
      const fullPath = `${APP_ROOT}/${filepath.replace(/^\/+/, "")}`;

      try {
        await sandbox.files.remove(fullPath);
        await prisma.projectFile.delete({
          where: { projectId_path: { projectId, path: filepath } },
        });

        return `File ${filepath} deleted successfully.`;
      } catch (e) {
        return `Failed to delete file ${filepath}: ${e}`;
      }
    },
    {
      name: "delete_file",
      description: "Delete a file",
      schema: z.object({
        filepath: z.string().describe("Path like src/old-component.tsx"),
      }),
    }
  );
}

function createExecuteCommandTool(sandbox: Sandbox) {
  return tool(
    async ({ command }) => {
      // Block app creation commands - the app already exists
      const blockedPatterns = [
        /npx\s+create-react-app/,
        /npm\s+create\s+vite/,
        /npm\s+create\s+.*app/,
        /create-react-app/,
        /create-vite/,
      ];

      const isBlocked = blockedPatterns.some((pattern) =>
        pattern.test(command)
      );
      if (isBlocked) {
        return `ERROR: App creation commands are not allowed. The React app already exists at ${APP_ROOT}. Instead, use the 'write' or 'write-multiple-files' tools to create/modify files directly. For example, use 'write' to create src/components/YourComponent.tsx instead of creating a new app.`;
      }

      try {
        await sandbox.commands.run(`cd ${APP_ROOT} && ${command}`);
        return `Command executed successfully.`;
      } catch (e) {
        return `Command failed: ${e}`;
      }
    },
    {
      name: "execute_command",
      description:
        "Execute a shell command in /home/user/react-app (e.g., npm install, npm run build). NOTE: Do NOT use this to create new React apps - the app already exists. Use 'write' tools instead.",
      schema: z.object({
        command: z.string().describe("The shell command to run"),
      }),
    }
  );
}

function createRenameFileTool(sandbox: Sandbox, projectId: string) {
  return tool(
    async ({ oldPath, newPath }) => {
      const oldFullPath = `${APP_ROOT}/${oldPath.replace(/^\/+/, "")}`;
      const newFullPath = `${APP_ROOT}/${newPath.replace(/^\/+/, "")}`;

      try {
        await sandbox.files.rename(oldFullPath, newFullPath);
        await prisma.projectFile.update({
          where: { projectId_path: { projectId, path: oldPath } },
          data: { path: newPath, updatedAt: new Date() },
        });

        return `File renamed from ${oldPath} to ${newPath}`;
      } catch (e) {
        return `Failed to rename file: ${e}`;
      }
    },
    {
      name: "rename_file",
      description: "Rename or move a file",
      schema: z.object({
        oldPath: z.string().describe("The current path of the file"),
        newPath: z.string().describe("The new path of the file"),
      }),
    }
  );
}

function createListDirectoriesTool(sandbox: Sandbox) {
  return tool(
    async ({ path }) => {
      const cmd = `tree -I 'node_modules|.*' ${path}`;
      const tree = await sandbox.commands.run(cmd);

      return `Directory structure:\n${tree}`;
    },
    {
      name: "list_directories",
      description:
        "List directory structure (excludes node_modules and hidden files)",
      schema: z.object({
        path: z
          .string()
          .default(".")
          .describe('Relative path like "." or "src"'),
      }),
    }
  );
}

function createTestBuildTool(sandbox: Sandbox) {
  return tool(
    async () => {
      try {
        await sandbox.commands.run(
          `cd ${APP_ROOT} && rm -rf node_modules/.vite-temp && npm install`
        );
        await sandbox.commands.run(`npm run build`);
        return `Build PASSED successfully.`;
      } catch (e) {
        return `Build FAILED: ${e}`;
      }
    },
    {
      name: "test_build",
      description:
        "Run npm install and npm run build to validate the app compiles",
      schema: z.object({}),
    }
  );
}

function createWriteMultipleFilesTool(sandbox: Sandbox, projectId: string) {
  return tool(
    async ({ files }) => {
      try {
        const fileObjects = files.map((f) => ({
          path: `${APP_ROOT}/${f.path.replace(/^\/+/, "")}`,
          content: f.content,
        }));

        for (const file of fileObjects) {
          await sandbox.files.write(file.path, file.content);
        }

        await prisma.projectFile.createMany({
          data: fileObjects.map((f) => ({
            projectId,
            path: f.path,
            content: f.content,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
          skipDuplicates: true,
        });

        const paths = files.map((f) => f.path);
        return `Successfully created ${paths.length} files: ${paths.join(", ")}`;
      } catch (e) {
        return `Failed to create files: ${e}`;
      }
    },
    {
      name: "write_multiple_files",
      description: "Create multiple files at once for efficiency",
      schema: z.object({
        files: z
          .array(
            z.object({
              path: z.string().describe("Relative path (e.g., src/App.tsx)"),
              content: z.string().describe("File contents"),
            })
          )
          .min(1),
      }),
    }
  );
}

function createStartDevServerTool(sandbox: Sandbox) {
  return tool(
    async () => {
      try {
        // Check if server is already running
        const checkOutput = await sandbox.commands.run(
          `lsof -ti:5173 2>/dev/null || echo "not_running"`
        );
        if (!checkOutput.stdout.includes("not_running")) {
          return `Dev server is already running on port 5173. Preview URL: https://5173-${sandbox.sandboxId}.e2b.app`;
        }

        const checkPackageJson = await sandbox.commands.run(
          `cd ${APP_ROOT} && test -f package.json && echo "exists" || echo "missing"`
        );
        if (checkPackageJson.stdout.includes("missing")) {
          return `Error: package.json not found in ${APP_ROOT}. Make sure you're working in the correct directory.`;
        }

        await sandbox.commands.run(
          `cd ${APP_ROOT} && nohup npm run dev > /tmp/vite.log 2>&1 &`
        );

        let attempts = 0;
        let serverRunning = false;
        while (attempts < 10 && !serverRunning) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const verifyOutput = await sandbox.commands.run(
            `lsof -ti:5173 2>/dev/null || echo "not_running"`
          );
          if (!verifyOutput.stdout.includes("not_running")) {
            serverRunning = true;
            break;
          }
          attempts++;
        }

        if (serverRunning) {
          return `Dev server started successfully on port 5173.\n\nPreview URL: https://5173-${sandbox.sandboxId}.e2b.app\n\nThe dev server is running in the background. You can access your app at the preview URL above.`;
        } else {
          const logs = await sandbox.commands.run(
            `tail -20 /tmp/vite.log 2>/dev/null || echo "No logs available"`
          );
          return `Dev server may not have started properly. Check the logs:\n${logs.stdout}\n\nYou can try running 'cd ${APP_ROOT} && npm run dev' manually in the sandbox.`;
        }
      } catch (e) {
        return `Failed to start dev server: ${e}. You can try running 'cd ${APP_ROOT} && npm run dev' manually in the sandbox.`;
      }
    },
    {
      name: "start_dev_server",
      description:
        "Start the Vite dev server on port 5173 in the background. This makes the app accessible via the preview URL. The React app should already be set up in /home/user/react-app - do not create a new app.",
      schema: z.object({}),
    }
  );
}

function createSearchTool() {
  return tool(
    async ({ query, type }) => {
      const options: any = {
        useAutoPrompts: true,
        numResuls: 3,
        type: "neural",
      };

      if (type === "general") {
        options.contents = {
          text: true,
        };
      }

      const response = await exaClient.search(query, options);
      const formattedResults = response.results.map((result: any) => {
        if (type === "image") {
          return {
            title: result.title,
            image: result.image,
            url: result.url,
          };
        } else {
          const summary = result.summary;
          return {
            title: result.title,
            url: result.url,
            text: summary,
          };
        }
      });

      return `Found ${formattedResults.length} results:\n${formattedResults.map((result) => `${result?.title}\n${result?.url}\n${result?.image}`).join("\n")}`;
    },
    {
      name: "search",
      description: "Search the web for information",
      schema: z.object({
        query: z.string().describe("The query to search for"),
        type: z.enum(["general", "image"]).default("general"),
      }),
    }
  );
}

export async function closeSandbox(projectId: string) {
  const sandbox = await createSandbox(projectId);
  await sandbox.kill();
}