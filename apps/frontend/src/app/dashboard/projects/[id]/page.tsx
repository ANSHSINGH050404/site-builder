"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Send,
  Bot,
  User,
  Wrench,
  AlertTriangle,
  Monitor,
  Zap,
  RefreshCw,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { getProjectById } from "@/lib/api";
import {
  useProjectStore,
  useAuthStore,
  type ConversationMessage,
} from "@/lib/store";

const TOOL_LABELS: Record<string, string> = {
  CREATE_FILE: "Create File",
  READ_FILE: "Read File",
  DELETE_FILE: "Delete File",
  EXECUTE_COMMAND: "Execute Command",
  RENAME_FILE: "Rename File",
  LIST_DIRECTORIES: "List Directories",
  TEST_BUILD: "Test Build",
  WRITE_MULTIPLE_FILES: "Write Multiple Files",
  CHECK_MISSING_DEPENDENCIES: "Check Dependencies",
  ADD_DEPENDENCY: "Add Dependency",
};

export default function ProjectPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params?.id as string;

  const { isAuthenticated } = useAuthStore();
  const {
    activeProject,
    setActiveProject,
    conversations,
    setConversations,
    addConversation,
    updateConversation,
    updateProject,
  } = useProjectStore();

  const [loadingProject, setLoadingProject] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // "idle" | "creating" | "live" | "error"
  const [sandboxStatus, setSandboxStatus] = useState<
    "idle" | "creating" | "live" | "error"
  >("idle");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Fetch project
  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/auth");
      return;
    }

    const load = async () => {
      try {
        const res = await getProjectById(projectId);
        setActiveProject(res.data);
        // Populate conversations from project if available
        if (res.data.conversations) {
          setConversations(res.data.conversations);
        } else {
          // Seed with the initial prompt as first USER message if no conversations yet
          setConversations([]);
        }
      } catch {
        router.push("/dashboard");
      } finally {
        setLoadingProject(false);
      }
    };
    load();
  }, [projectId, isAuthenticated, router, setActiveProject, setConversations]);

  // Sync sandbox status from loaded project data
  useEffect(() => {
    if (!activeProject) return;
    if (activeProject.sandboxUrl) setSandboxStatus("live");
    else if (activeProject.sandboxId) setSandboxStatus("creating");
    // else remains "idle"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id]);

  useEffect(() => {
    scrollToBottom();
  }, [conversations, scrollToBottom]);

  // Ref to track if we already fired the autostart so we don't fire twice
  const autoStartFiredRef = useRef(false);

  const handleSend = async (msgOverride?: string) => {
    // Determine the content depending on if it's called with a string override
    const content = (
      typeof msgOverride === "string" ? msgOverride : message
    ).trim();
    if (!content || sending) return;
    setSendError("");
    setMessage("");
    setSending(true);

    // Optimistic UI — show user message immediately
    const userMsg: ConversationMessage = {
      id: `tmp-${Date.now()}`,
      projectId,
      from: "USER",
      type: "TEXT_MESSAGE",
      contents: content,
      createdAt: new Date().toISOString(),
    };
    addConversation(userMsg);

    try {
      const apiBase =
        process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

      // Use fetch with ReadableStream to consume the SSE from /chat
      const response = await fetch(`${apiBase}/projects/${projectId}/chat`, {
        method: "POST",
        credentials: "include", // send cookie
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content }),
      });

      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error || "Failed to contact agent");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let currentAgentMsgId = "";
      let currentAgentContents = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE chunks are separated by double newlines
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? ""; // keep the last incomplete chunk in the buffer

        for (const part of parts) {
          const eventLine = part.match(/^event: (.+)$/m)?.[1];
          const dataLine = part.match(/^data: (.+)$/m)?.[1];
          if (!dataLine) continue;

          let payload: any;
          try {
            payload = JSON.parse(dataLine);
          } catch {
            continue;
          }

          if (eventLine === "message") {
            if (!currentAgentMsgId) {
              currentAgentMsgId = `agent-${Date.now()}`;
              addConversation({
                id: currentAgentMsgId,
                projectId,
                from: "AGENT",
                type: "TEXT_MESSAGE",
                contents: payload.contents || "...",
                createdAt: new Date().toISOString(),
              });
              currentAgentContents = payload.contents;
            } else {
              currentAgentContents += payload.contents || "";
              updateConversation(currentAgentMsgId, {
                contents: currentAgentContents,
              });
            }
          } else if (eventLine === "tool_call") {
            setSandboxStatus("creating");
            const toolMsgId = `tool-${Date.now()}-${Math.random()}`;
            addConversation({
              id: toolMsgId,
              projectId,
              from: "AGENT",
              type: "TOOL_CALL",
              contents: `Executing tool: ${payload.tool}\n${payload.args || ""}`,
              toolCall: payload.tool?.toUpperCase().replace(/-/g, "_") as any,
              createdAt: new Date().toISOString(),
            });
          } else if (eventLine === "preview_url") {
            setPreviewUrl(payload.url);
            setSandboxStatus("live");
            setActiveProject({ ...activeProject!, sandboxUrl: payload.url });
          } else if (eventLine === "error") {
            setSandboxStatus("error");
            setSendError(payload.message || "Agent error");
          }
        }
      }
    } catch (err: any) {
      setSendError(err?.message || "Failed to send message. Please try again.");
    } finally {
      setSending(false);
    }
  };

  // Auto-trigger agent when arriving from a fresh project creation
  useEffect(() => {
    if (loadingProject || autoStartFiredRef.current) return;
    const autostart = searchParams?.get("autostart");
    const prompt = searchParams?.get("prompt");

    if (autostart === "1" && prompt) {
      autoStartFiredRef.current = true;

      // We process the prompt but we do NOT clear the URL immediately via replaceState
      // because in React Strict Mode that causes the second render to see a blank URL
      // before the timeout can even fire.
      const decoded = decodeURIComponent(prompt);
      setMessage(decoded);

      const timer = setTimeout(() => {
        handleSend(decoded);
        // Clean up the URL only *after* we've successfully initiated sending
        window.history.replaceState({}, "", window.location.pathname);
      }, 500);

      return () => {
        // We only reset the ref so StrictMode's second mount can pick it up
        autoStartFiredRef.current = false;
        clearTimeout(timer);
      };
    }
  }, [loadingProject, searchParams]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderMessage = (msg: ConversationMessage, idx: number) => {
    const isUser = msg.from === "USER";
    const isToolCall = msg.type === "TOOL_CALL";
    const isError = msg.type === "ERROR_MESSAGE";

    return (
      <div
        key={msg.id || idx}
        className={`chat-message ${isUser ? "user" : ""}`}
        style={{ animationDelay: `${idx * 0.03}s` }}
      >
        {/* Avatar */}
        <div
          className={`chat-avatar ${isUser ? "user-avatar" : "agent-avatar"}`}
        >
          {isUser ? <User size={14} /> : <Bot size={14} />}
        </div>

        {/* Bubble */}
        <div
          className={`chat-bubble ${
            isUser
              ? "user-bubble"
              : isToolCall
                ? "tool-bubble"
                : isError
                  ? "error-bubble"
                  : "agent-bubble"
          }`}
        >
          {isToolCall && msg.toolCall && (
            <div className="tool-chip" style={{ marginBottom: 6 }}>
              <Wrench size={11} />
              {TOOL_LABELS[msg.toolCall] || msg.toolCall}
            </div>
          )}
          {isError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 6,
                fontWeight: 600,
              }}
            >
              <AlertTriangle size={13} />
              Error
            </div>
          )}
          <span style={{ whiteSpace: "pre-wrap" }}>{msg.contents}</span>
        </div>
      </div>
    );
  };

  if (loadingProject) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
          background: "var(--bg-base)",
        }}
      >
        <Loader2
          size={32}
          color="var(--accent)"
          style={{ animation: "spin 1s linear infinite" }}
        />
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Loading project…
        </p>
      </div>
    );
  }

  return (
    <div className="dashboard-wrapper">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-logo-icon">
            <Zap size={17} color="#fff" strokeWidth={2.5} />
          </div>
          <span className="sidebar-logo-text">SiteBuilder AI</span>
        </div>

        <button
          id="back-to-dashboard"
          className="sidebar-item"
          onClick={() => router.push("/dashboard")}
        >
          <ArrowLeft size={16} className="sidebar-item-icon" />
          All Projects
        </button>

        <div className="divider" style={{ margin: "8px 0" }} />

        {activeProject && (
          <>
            <span className="sidebar-section-label">Current Project</span>
            <div
              style={{
                padding: "12px",
                background: "var(--accent-dim)",
                borderRadius: "var(--radius-sm)",
                border: "1px solid rgba(108,99,255,0.2)",
              }}
            >
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--accent-light)",
                  marginBottom: 6,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {activeProject.title}
              </p>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  lineHeight: 1.5,
                }}
              >
                {activeProject.initialPrompt.slice(0, 100)}
                {activeProject.initialPrompt.length > 100 ? "…" : ""}
              </p>
            </div>

            {activeProject.sandboxUrl && (
              <>
                <span
                  className="sidebar-section-label"
                  style={{ marginTop: 16 }}
                >
                  Sandbox
                </span>
                <div
                  style={{
                    padding: "10px 12px",
                    background: "var(--emerald-dim)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid rgba(16,185,129,0.2)",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span className="status-dot online" />
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--emerald)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Sandbox active
                  </span>
                </div>
              </>
            )}
          </>
        )}
      </aside>

      {/* Main */}
      <div className="main-content">
        <header className="topbar">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              id="back-btn-topbar"
              className="btn btn-ghost"
              style={{ padding: "7px 12px" }}
              onClick={() => router.push("/dashboard")}
            >
              <ArrowLeft size={15} />
            </button>
            <span className="topbar-title">
              {activeProject?.title || "Project"}
            </span>
          </div>
          <div className="topbar-actions">
            {activeProject?.sandboxUrl && (
              <a
                id="open-sandbox-link"
                href={activeProject.sandboxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost"
                style={{ padding: "7px 14px", fontSize: 13 }}
              >
                <ExternalLink size={14} />
                Open Sandbox
              </a>
            )}
          </div>
        </header>

        {/* ── Sandbox Status Bar ── */}
        {(() => {
          const liveUrl = previewUrl || activeProject?.sandboxUrl;
          const status = liveUrl ? "live" : sandboxStatus;
          const cfg = {
            idle: {
              bg: "rgba(255,255,255,0.04)",
              border: "rgba(255,255,255,0.07)",
              dot: "#666",
              pulse: false,
              label: "No sandbox yet",
              sub: "Send a message to start building",
            },
            creating: {
              bg: "rgba(234,179,8,0.08)",
              border: "rgba(234,179,8,0.2)",
              dot: "#eab308",
              pulse: true,
              label: "Sandbox starting…",
              sub: "Agent is setting up your environment",
            },
            live: {
              bg: "rgba(16,185,129,0.08)",
              border: "rgba(16,185,129,0.2)",
              dot: "#10b981",
              pulse: false,
              label: "Sandbox live",
              sub: liveUrl || "",
            },
            error: {
              bg: "rgba(239,68,68,0.08)",
              border: "rgba(239,68,68,0.2)",
              dot: "#ef4444",
              pulse: false,
              label: "Sandbox error",
              sub: "Check the chat for details",
            },
          }[status];
          return (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 20px",
                background: cfg.bg,
                borderBottom: `1px solid ${cfg.border}`,
                transition: "all 0.4s ease",
              }}
            >
              {/* Dot */}
              <span
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {cfg.pulse && (
                  <span
                    style={{
                      position: "absolute",
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: cfg.dot,
                      opacity: 0.25,
                      animation: "ping 1.2s cubic-bezier(0,0,0.2,1) infinite",
                    }}
                  />
                )}
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: cfg.dot,
                    display: "block",
                  }}
                />
              </span>

              {/* Labels */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  whiteSpace: "nowrap",
                }}
              >
                {cfg.label}
              </span>
              {cfg.sub && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--text-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {status === "live" ? (
                    <a
                      href={liveUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "#10b981",
                        textDecoration: "none",
                        fontFamily: "var(--font-mono, monospace)",
                        fontSize: 11,
                      }}
                    >
                      {liveUrl}
                    </a>
                  ) : (
                    cfg.sub
                  )}
                </span>
              )}

              {/* Open button */}
              {status === "live" && liveUrl && (
                <a
                  id="sandbox-open-btn"
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-ghost"
                  style={{
                    padding: "4px 12px",
                    fontSize: 12,
                    marginLeft: "auto",
                    flexShrink: 0,
                    border: "1px solid rgba(16,185,129,0.3)",
                    color: "#10b981",
                  }}
                >
                  <ExternalLink size={12} />
                  Open
                </a>
              )}

              {/* Spinner when creating */}
              {status === "creating" && (
                <RefreshCw
                  size={13}
                  style={{
                    color: "#eab308",
                    animation: "spin 1s linear infinite",
                    marginLeft: "auto",
                    flexShrink: 0,
                  }}
                />
              )}
            </div>
          );
        })()}

        <div className="project-layout">
          {/* Chat Panel */}
          <div className="chat-panel">
            <div className="chat-header">
              <div
                style={{
                  width: 28,
                  height: 28,
                  background: "var(--accent-dim)",
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Bot size={15} color="var(--accent-light)" />
              </div>
              <span className="chat-header-title">AI Agent</span>
              <div
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span className="status-dot online" />
                <span style={{ fontSize: 11, color: "var(--emerald)" }}>
                  Ready
                </span>
              </div>
            </div>

            {/* Messages */}
            <div className="chat-messages" id="chat-messages">
              {conversations.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <Bot size={26} />
                  </div>
                  <p className="empty-state-title">Start the conversation</p>
                  <p className="empty-state-desc">
                    Describe what you want the AI to build or modify. The agent
                    will execute code, create files, and deploy your site.
                  </p>
                </div>
              ) : (
                conversations.map((msg, idx) => renderMessage(msg, idx))
              )}

              {/* Sending indicator */}
              {sending && (
                <div className="chat-message" style={{ animationDelay: "0s" }}>
                  <div className="chat-avatar agent-avatar">
                    <Bot size={14} />
                  </div>
                  <div
                    className="chat-bubble agent-bubble"
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                  >
                    <span
                      className="animate-pulse"
                      style={{ display: "flex", gap: 4 }}
                    >
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            background: "var(--text-secondary)",
                            display: "inline-block",
                            animation: `pulse 1s ${i * 0.2}s ease infinite`,
                          }}
                        />
                      ))}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Thinking…
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Send error */}
            {sendError && (
              <div
                className="alert alert-error"
                style={{ margin: "0 20px 8px" }}
              >
                <AlertTriangle size={13} />
                {sendError}
              </div>
            )}

            {/* Input */}
            <div className="chat-input-area">
              <textarea
                ref={textareaRef}
                id="chat-input"
                className="chat-textarea"
                placeholder="Tell the AI what to build or change… (Enter to send)"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                disabled={sending}
              />
              <button
                id="send-message-btn"
                className="chat-send-btn"
                onClick={() => handleSend()}
                disabled={!message.trim() || sending}
                aria-label="Send message"
              >
                {sending ? (
                  <RefreshCw
                    size={17}
                    style={{ animation: "spin 1s linear infinite" }}
                  />
                ) : (
                  <Send size={17} />
                )}
              </button>
            </div>
          </div>

          {/* Preview Panel */}
          <div className="preview-panel">
            <div className="preview-header">
              <div className="preview-title">
                <Monitor size={14} />
                Live Preview
              </div>
              {activeProject?.sandboxUrl && (
                <div className="preview-url-bar">
                  {activeProject.sandboxUrl}
                </div>
              )}
            </div>

            {previewUrl || activeProject?.sandboxUrl ? (
              <iframe
                className="preview-iframe"
                src={previewUrl || activeProject!.sandboxUrl!}
                title="Site Preview"
                sandbox="allow-scripts allow-same-origin allow-forms"
              />
            ) : (
              <div className="preview-placeholder">
                <div className="preview-placeholder-icon">🌐</div>
                <p className="preview-placeholder-title">
                  No preview available yet
                </p>
                <p className="preview-placeholder-desc">
                  Once the AI agent deploys your site to a sandbox environment,
                  the live preview will appear here.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
