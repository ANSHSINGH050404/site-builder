# SiteBuilder AI

An AI-powered website builder — describe what you want, and the agent writes code, runs it in a live sandbox, and gives you a preview URL. Built with **Next.js**, **Express**, **LangGraph**, and **E2B** sandboxes.

## Architecture

```
site-builder/
├── apps/
│   ├── frontend/      # Next.js 16 app (port 3001)
│   └── backend/       # Express + LangGraph agent (port 3000)
└── packages/
    ├── db/            # Prisma client (PostgreSQL via Neon)
    └── ui/            # Shared UI components
```

### How it works

1. **User creates a project** with a title and description on the dashboard
2. **User sends a message** in the project chat — "Build me a todo app with dark mode"
3. **Backend receives the message** on `POST /projects/:id/chat` and streams SSE events back
4. **LangGraph agent** runs a planner → agent → tools loop inside an **E2B sandbox**
5. **Agent writes files**, runs commands, and starts the Vite dev server
6. **Preview URL** (`https://5173-<sandboxId>.e2b.app`) is streamed back to the frontend
7. **Live preview iframe** appears in the right panel

---

## Prerequisites

| Tool       | Version                                    |
| ---------- | ------------------------------------------ |
| Node.js    | ≥ 18                                       |
| Bun        | 1.3.5+                                     |
| PostgreSQL | via [Neon](https://neon.tech) (serverless) |

---

## Environment Variables

### `apps/backend/.env`

```env
DATABASE_URL=postgresql://...            # Neon connection string
GOOGLE_API_KEY=...                       # Google Gemini API key
JWT_SECRET=...                           # Any random secret
E2B_API_KEY=...                          # E2B API key (https://e2b.dev)
FRONTEND_URL=http://localhost:3001
EXASEARCH_API_KEY=...                    # Exa search API key (https://exa.ai)
E2B_TEMPLATE=site-builder-react-base-dev # Optional — uses code-interpreter-v1 as fallback
```

### `apps/frontend/.env`

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### `packages/db/.env`

```env
DATABASE_URL=postgresql://...            # Same as backend
```

---

## Getting Started

### 1. Install dependencies

```sh
bun install
```

### 2. Set up the database

```sh
cd packages/db
bun run db:deploy        # Run migrations against your Neon DB
bun run db:generate      # Generate the Prisma client
```

### 3. (Optional) Build the E2B sandbox template

This pre-installs a React + Vite + Tailwind environment in E2B for faster project starts.

```sh
cd apps/backend
bun run build-template-dev
```

Without this, the agent falls back to `code-interpreter-v1` and sets up the React app itself on first use.

### 4. Start development servers

```sh
# From the root — starts both frontend (3001) and backend (3000) concurrently
bun run dev
```

Or individually:

```sh
# Backend
cd apps/backend
bun run dev

# Frontend
cd apps/frontend
bun run dev
```

---

## API Reference

| Method | Endpoint                      | Auth | Description                            |
| ------ | ----------------------------- | ---- | -------------------------------------- |
| `POST` | `/auth/register`              | ❌   | Register a new user                    |
| `POST` | `/auth/login`                 | ❌   | Login, sets JWT cookie                 |
| `GET`  | `/projects`                   | ✅   | List all projects for the current user |
| `POST` | `/projects`                   | ✅   | Create a new project                   |
| `GET`  | `/projects/:id`               | ✅   | Get project with conversation history  |
| `POST` | `/projects/:id/chat`          | ✅   | Send message to AI agent (SSE stream)  |
| `POST` | `/projects/:id/conversations` | ✅   | Save a conversation message            |
| `GET`  | `/health`                     | ❌   | Health check                           |

### SSE Event Types (`POST /projects/:id/chat`)

The chat endpoint streams Server-Sent Events:

| Event         | Payload                    | Description            |
| ------------- | -------------------------- | ---------------------- |
| `message`     | `{ from, type, contents }` | AI text response       |
| `tool_call`   | `{ tool, args }`           | Agent tool invocation  |
| `preview_url` | `{ url }`                  | Sandbox dev server URL |
| `error`       | `{ message }`              | Agent error            |
| `done`        | `{ message }`              | Stream complete        |

---

## Agent Tools

The LangGraph agent has access to these tools inside the E2B sandbox:

| Tool                         | Description                                  |
| ---------------------------- | -------------------------------------------- |
| `write_file`                 | Create or overwrite a single file            |
| `write_multiple_files`       | Create/overwrite multiple files at once      |
| `read_file`                  | Read a file's contents                       |
| `delete_file`                | Delete a file                                |
| `rename_file`                | Rename/move a file                           |
| `execute_command`            | Run shell commands in `/home/user/react-app` |
| `list_directories`           | List directory structure                     |
| `add_dependency`             | Install npm packages                         |
| `test_build`                 | Run `npm run build` and return output        |
| `check_missing_dependencies` | Check for undeclared imports                 |
| `start_dev_server`           | Start the Vite dev server on port 5173       |
| `get_context`                | Retrieve project title, goal, and file list  |
| `save_context`               | Save a note about current project state      |
| `search`                     | Web search via Exa API                       |

---

## Tech Stack

- **Frontend**: Next.js 16, React 19, Zustand, Axios, Lucide React
- **Backend**: Express 5, Bun runtime, LangGraph, LangChain
- **AI**: Google Gemini 2.0 Flash via `@langchain/google`
- **Sandboxes**: E2B Code Interpreter (`@e2b/code-interpreter`)
- **Database**: PostgreSQL (Neon) via Prisma ORM
- **Monorepo**: Turborepo + Bun workspaces
- **Auth**: JWT in HTTP-only cookies
