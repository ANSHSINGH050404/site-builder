import axios from "axios";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // send cookies for JWT auth
  headers: {
    "Content-Type": "application/json",
  },
});

// --- Auth ---
export const registerUser = (email: string, password: string) =>
  api.post("/auth/register", { email, password });



export const loginUser = (email: string, password: string) =>

  api.post("/auth/login", { email, password });

// --- Projects ---
export const getProjects = () => api.get("/projects");

export const getProjectById = (id: string) => api.get(`/projects/${id}`);

export const createProject = (title: string, initialPrompt: string) =>
  api.post("/projects", { title, initialPrompt });

// --- Conversations ---
export const createConversationMessage = (
  projectId: string,
  payload: {
    contents: string;
    type: "TEXT_MESSAGE" | "TOOL_CALL" | "ERROR_MESSAGE";
    from: "USER" | "AGENT";
    toolCall?: string | null;
  },
) => api.post(`/projects/${projectId}/conversations`, payload);
