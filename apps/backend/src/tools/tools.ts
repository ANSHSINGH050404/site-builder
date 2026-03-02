import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";
import { prisma } from "db";
import { Exa } from "exa-js";
import { createSandbox } from "../services/sandbox.service";

const APP_ROOT = "/home/user/react-app";

// Lazy — only instantiated when the search tool is actually called
let _exaClient: Exa | null = null;
function getExaClient(): Exa {
  if (!_exaClient) {
    const key = process.env.EXASEARCH_API_KEY || process.env.EXA_API_KEY;
    if (!key) throw new Error("EXASEARCH_API_KEY is not set in .env");
    _exaClient = new Exa(key);
  }
  return _exaClient;
}

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
    createCheckMissingDependenciesTool(sandbox),
    createGetContextTool(projectId),
    createSaveContextTool(projectId),
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
    },
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
    },
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
    },
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
    },
  );
}

function createExecuteCommandTool(sandbox: Sandbox) {
  return tool(
    async ({ command }) => {
      // Only block app-creation commands if the React app ALREADY EXISTS.
      // This prevents the agent from accidentally bootstrapping a new project
      // inside an existing one, while allowing the initial fallback setup to work.
      const appCreationPatterns = [
        /npx\s+create-react-app/,
        /npm\s+create\s+vite/,
        /npm\s+create\s+.*app/,
        /create-react-app/,
        /create-vite/,
      ];

      const isAppCreationCmd = appCreationPatterns.some((p) => p.test(command));
      if (isAppCreationCmd) {
        // Check if the app already exists before blocking
        try {
          const check = await sandbox.commands.run(
            `test -f ${APP_ROOT}/package.json && echo "APP_EXISTS" || echo "APP_MISSING"`,
          );
          if (check.stdout.includes("APP_EXISTS")) {
            return (
              `ERROR: The React app already exists at ${APP_ROOT}. ` +
              `Do NOT run app-creation commands again. ` +
              `Use 'write_file' or 'write_multiple_files' to create/modify files instead.`
            );
          }
          // App doesn't exist — allow the creation command to proceed from /home/user
        } catch {
          // Can't check — be safe and allow it
        }
      }

      try {
        // For app-creation commands, run from /home/user (not inside react-app)
        const cwd = isAppCreationCmd ? "/home/user" : APP_ROOT;
        const result = await sandbox.commands.run(`cd ${cwd} && ${command}`);
        const output = [result.stdout, result.stderr]
          .filter(Boolean)
          .join("\n")
          .trim();
        return output
          ? `Command executed successfully.\n\nOutput:\n${output}`
          : `Command executed successfully (no output).`;
      } catch (e: any) {
        const stdout = e?.stdout || "";
        const stderr = e?.stderr || "";
        const detail = [stdout, stderr].filter(Boolean).join("\n").trim();
        return `Command failed: ${e}${detail ? `\n\nOutput:\n${detail}` : ""}`;
      }
    },
    {
      name: "execute_command",
      description:
        "Execute a shell command in /home/user/react-app (e.g., npm install, npm run build). NOTE: Do NOT use this to create new React apps - the app already exists. Use 'write' tools instead.",
      schema: z.object({
        command: z.string().describe("The shell command to run"),
      }),
    },
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
    },
  );
}

function createListDirectoriesTool(sandbox: Sandbox) {
  return tool(
    async ({ path }) => {
      const cmd = `tree -I 'node_modules|.*' ${path}`;
      try {
        const result = await sandbox.commands.run(cmd);
        return `Directory structure:\n${result.stdout || result.stderr || "(empty)"}`;
      } catch (e: any) {
        // Fallback to ls if tree isn't available
        try {
          const fallback = await sandbox.commands.run(
            `find ${path} -not -path '*/node_modules/*' -not -path '*/.*' | sort | head -100`,
          );
          return `Directory structure:\n${fallback.stdout || "(empty)"}`;
        } catch {
          return `Failed to list directories: ${e}`;
        }
      }
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
    },
  );
}

function createTestBuildTool(sandbox: Sandbox) {
  return tool(
    async () => {
      try {
        const installResult = await sandbox.commands.run(
          `cd ${APP_ROOT} && rm -rf node_modules/.vite-temp && npm install`,
        );
        const buildResult = await sandbox.commands.run(
          `cd ${APP_ROOT} && npm run build`,
        );
        const output = [
          installResult.stdout,
          buildResult.stdout,
          buildResult.stderr,
        ]
          .filter(Boolean)
          .join("\n")
          .trim();
        return `Build PASSED successfully.${output ? `\n\nOutput:\n${output}` : ""}`;
      } catch (e: any) {
        const detail = [e?.stdout, e?.stderr].filter(Boolean).join("\n").trim();
        return `Build FAILED: ${e}${detail ? `\n\nOutput:\n${detail}` : ""}`;
      }
    },
    {
      name: "test_build",
      description:
        "Run npm install and npm run build to validate the app compiles. Returns detailed error output if it fails.",
      schema: z.object({}),
    },
  );
}

function createWriteMultipleFilesTool(sandbox: Sandbox, projectId: string) {
  return tool(
    async ({ files }) => {
      try {
        for (const f of files) {
          const fullPath = `${APP_ROOT}/${f.path.replace(/^\/+/, "")}`;
          await sandbox.files.write(fullPath, f.content);

          await prisma.projectFile.upsert({
            where: { projectId_path: { projectId, path: f.path } },
            create: {
              projectId,
              path: f.path,
              content: f.content,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            update: {
              content: f.content,
              updatedAt: new Date(),
            },
          });
        }

        const paths = files.map((f) => f.path);
        return `Successfully wrote ${paths.length} files: ${paths.join(", ")}`;
      } catch (e) {
        return `Failed to write files: ${e}`;
      }
    },
    {
      name: "write_multiple_files",
      description: "Create or overwrite multiple files at once for efficiency",
      schema: z.object({
        files: z
          .array(
            z.object({
              path: z.string().describe("Relative path (e.g., src/App.tsx)"),
              content: z.string().describe("File contents"),
            }),
          )
          .min(1),
      }),
    },
  );
}

function createStartDevServerTool(sandbox: Sandbox) {
  return tool(
    async () => {
      try {
        // Check if server is already running
        const checkOutput = await sandbox.commands.run(
          `lsof -ti:5173 2>/dev/null || echo "not_running"`,
        );
        if (!checkOutput.stdout.includes("not_running")) {
          return `Dev server is already running on port 5173. Preview URL: https://5173-${sandbox.sandboxId}.e2b.app`;
        }

        const checkPackageJson = await sandbox.commands.run(
          `cd ${APP_ROOT} && test -f package.json && echo "exists" || echo "missing"`,
        );
        if (checkPackageJson.stdout.includes("missing")) {
          return `Error: package.json not found in ${APP_ROOT}. Make sure you're working in the correct directory.`;
        }

        await sandbox.commands.run(
          `cd ${APP_ROOT} && nohup npm run dev > /tmp/vite.log 2>&1 &`,
        );

        let attempts = 0;
        let serverRunning = false;
        while (attempts < 10 && !serverRunning) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const verifyOutput = await sandbox.commands.run(
            `lsof -ti:5173 2>/dev/null || echo "not_running"`,
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
            `tail -20 /tmp/vite.log 2>/dev/null || echo "No logs available"`,
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
    },
  );
}

function createCheckMissingDependenciesTool(sandbox: Sandbox) {
  return tool(
    async () => {
      try {
        // Read package.json to get declared deps
        const pkgResult = await sandbox.commands.run(
          `cat ${APP_ROOT}/package.json`,
        );
        const pkg = JSON.parse(pkgResult.stdout || "{}");
        const declared = new Set([
          ...Object.keys(pkg.dependencies || {}),
          ...Object.keys(pkg.devDependencies || {}),
        ]);

        // Find all imports in source files
        const grepResult = await sandbox.commands.run(
          `grep -rh --include="*.tsx" --include="*.ts" --include="*.js" --include="*.jsx" -E "^import .+ from '([^.'][^']*)'\'" ${APP_ROOT}/src 2>/dev/null || true`,
        );

        const importLines = grepResult.stdout.split("\n").filter(Boolean);
        const importedPkgs = new Set<string>();
        for (const line of importLines) {
          const match = line.match(/from ['"]([^.'"][^'"]*)['"]/);
          if (match && match[1]) {
            // Extract root package name (handle scoped packages like @scope/pkg)
            const parts = match[1].split("/");
            const first = parts[0] ?? "";
            const pkgName = first.startsWith("@")
              ? `${first}/${parts[1] ?? ""}`
              : first;
            if (pkgName) importedPkgs.add(pkgName);
          }
        }

        const missing = [...importedPkgs].filter((p) => !declared.has(p));
        if (missing.length === 0) {
          return `All imported packages are declared in package.json.`;
        }
        return `Missing dependencies (imported but not in package.json): ${missing.join(", ")}\n\nRun: npm install ${missing.join(" ")} to install them.`;
      } catch (e) {
        return `Failed to check dependencies: ${e}`;
      }
    },
    {
      name: "check_missing_dependencies",
      description:
        "Check if all packages imported in source files are declared in package.json",
      schema: z.object({}),
    },
  );
}

function createGetContextTool(projectId: string) {
  return tool(
    async () => {
      try {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          select: { title: true, initialPrompt: true },
        });
        const files = await prisma.projectFile.findMany({
          where: { projectId },
          select: { path: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 20,
        });
        const filePaths =
          files.length > 0
            ? files.map((f) => f.path).join(", ")
            : "(no files yet)";
        return (
          `Project: ${project?.title || projectId}\n` +
          `Initial goal: ${project?.initialPrompt || ""}\n` +
          `Files created/modified: ${filePaths}`
        );
      } catch (e) {
        return `Failed to get context: ${e}`;
      }
    },
    {
      name: "get_context",
      description:
        "Retrieve saved project context — the project title, original goal, and list of files already created",
      schema: z.object({}),
    },
  );
}

function createSaveContextTool(projectId: string) {
  return tool(
    async ({ note }) => {
      try {
        // Store the note as an agent conversation message so it persists
        await prisma.conversation.create({
          data: {
            projectId,
            contents: `[CONTEXT NOTE] ${note}`,
            type: "TEXT_MESSAGE",
            from: "AGENT",
          },
        });
        return `Context note saved: ${note}`;
      } catch (e) {
        return `Failed to save context: ${e}`;
      }
    },
    {
      name: "save_context",
      description:
        "Save a note about the current project state for future sessions",
      schema: z.object({
        note: z
          .string()
          .describe("A brief note describing what has been built so far"),
      }),
    },
  );
}

function createSearchTool() {
  return tool(
    async ({ query, type }) => {
      const options: any = {
        useAutoPrompts: true,
        numResults: 3,
        type: "neural",
      };

      if (type === "general") {
        options.contents = {
          text: true,
        };
      }

      const response = await getExaClient().search(query, options);
      const formattedResults = response.results.map((result: any) => {
        if (type === "image") {
          return {
            title: result.title,
            image: result.image,
            url: result.url,
          };
        } else {
          return {
            title: result.title,
            url: result.url,
            text: result.text || result.summary || "",
          };
        }
      });

      return (
        `Found ${formattedResults.length} results:\n` +
        formattedResults
          .map(
            (r, i) =>
              `${i + 1}. ${r.title}\n   URL: ${r.url}${
                r.text ? `\n   ${r.text.slice(0, 300)}...` : ""
              }`,
          )
          .join("\n\n")
      );
    },
    {
      name: "search",
      description: "Search the web for information, documentation, or examples",
      schema: z.object({
        query: z.string().describe("The query to search for"),
        type: z.enum(["general", "image"]).default("general"),
      }),
    },
  );
}

export async function closeSandbox(projectId: string) {
  const sandbox = await createSandbox(projectId);
  await sandbox.kill();
}
