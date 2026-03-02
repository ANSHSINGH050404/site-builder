import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Project = {
  id: string;
  title: string;
  initialPrompt: string;
  sandboxUrl?: string | null;
  sandboxId?: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
};

export type ConversationMessage = {
  id: string;
  projectId: string;
  from: "USER" | "AGENT";
  type: "TEXT_MESSAGE" | "TOOL_CALL" | "ERROR_MESSAGE";
  contents: string;
  toolCall?: string | null;
  createdAt: string;
};

type AuthState = {
  isAuthenticated: boolean;
  setAuthenticated: (val: boolean) => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      setAuthenticated: (val) => set({ isAuthenticated: val }),
    }),
    { name: "auth-store" },
  ),
);

type ProjectStore = {
  projects: Project[];
  setProjects: (p: Project[]) => void;
  activeProject: Project | null;
  setActiveProject: (p: Project | null) => void;
  conversations: ConversationMessage[];
  setConversations: (msgs: ConversationMessage[]) => void;
  addConversation: (msg: ConversationMessage) => void;
  updateConversation: (
    id: string,
    updates: Partial<ConversationMessage>,
  ) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
};

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  setProjects: (projects) => set({ projects }),
  activeProject: null,
  setActiveProject: (activeProject) => set({ activeProject }),
  conversations: [],
  setConversations: (conversations) => set({ conversations }),
  addConversation: (msg) =>
    set((s) => ({ conversations: [...s.conversations, msg] })),
  updateConversation: (id, updates) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, ...updates } : c,
      ),
    })),
  updateProject: (id, updates) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
}));
