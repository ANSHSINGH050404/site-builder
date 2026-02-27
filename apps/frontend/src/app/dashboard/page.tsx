"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  FolderOpen,
  Plus,
  LogOut,
  Clock,
  Sparkles,
  X,
  Layers,
} from "lucide-react";
import { getProjects, createProject } from "@/lib/api";
import { useAuthStore, useProjectStore, type Project } from "@/lib/store";

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, setAuthenticated } = useAuthStore();
  const { projects, setProjects } = useProjectStore();

  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formTitle, setFormTitle] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [createError, setCreateError] = useState("");

  const fetchProjects = useCallback(async () => {
    try {
      const res = await getProjects();
      setProjects(res.data.projects || []);
    } catch {
      // Unauthorized – bounce to auth
      setAuthenticated(false);
      router.push("/auth");
    } finally {
      setLoading(false);
    }
  }, [setProjects, setAuthenticated, router]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/auth");
      return;
    }
    fetchProjects();
  }, [isAuthenticated, fetchProjects, router]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    if (!formTitle.trim() || !formPrompt.trim()) {
      setCreateError("Both fields are required.");
      return;
    }
    setCreating(true);
    try {
      const res = await createProject(formTitle.trim(), formPrompt.trim());
      const createdProject: Project = res.data.project;
      setProjects([createdProject, ...projects]);
      setShowModal(false);
      setFormTitle("");
      setFormPrompt("");
      router.push(
        `/dashboard/projects/${createdProject.id}?autostart=1&prompt=${encodeURIComponent(formPrompt.trim())}`,
      );
    } catch (err: any) {
      setCreateError(err?.response?.data?.error || "Failed to create project.");
    } finally {
      setCreating(false);
    }
  };

  const handleLogout = () => {
    setAuthenticated(false);
    router.push("/auth");
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

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

        <span className="sidebar-section-label">Navigation</span>

        <button className="sidebar-item active" id="nav-projects">
          <Layers size={16} className="sidebar-item-icon" />
          Projects
        </button>

        <div className="sidebar-footer">
          <button
            id="logout-btn"
            className="sidebar-item"
            onClick={handleLogout}
            style={{ width: "100%", color: "var(--rose)" }}
          >
            <LogOut size={16} className="sidebar-item-icon" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="main-content">
        <header className="topbar">
          <span className="topbar-title">Projects</span>
          <div className="topbar-actions">
            <button
              id="new-project-btn"
              className="btn btn-primary"
              style={{ width: "auto", padding: "9px 18px" }}
              onClick={() => setShowModal(true)}
            >
              <Plus size={16} />
              New Project
            </button>
          </div>
        </header>

        <main className="projects-container">
          {/* Welcome banner */}
          <div className="welcome-banner">
            <div className="welcome-banner-icon">
              <Sparkles size={28} />
            </div>
            <div className="welcome-banner-text">
              <h2>Build websites with the power of AI</h2>
              <p>
                Describe what you want to build and our AI agent will write the
                code, test it, and deploy it — all inside a sandboxed
                environment.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="empty-state">
              <div
                className="spinner spinner-accent"
                style={{ width: 32, height: 32 }}
              />
              <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
                Loading projects…
              </p>
            </div>
          ) : (
            <>
              <h1 className="projects-heading">Your Projects</h1>
              <p className="projects-subheading">
                {projects.length === 0
                  ? "No projects yet. Create your first one!"
                  : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
              </p>

              <div className="projects-grid">
                {/* New project card */}
                <div
                  id="create-project-card"
                  className="new-project-card"
                  onClick={() => setShowModal(true)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setShowModal(true)}
                >
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      background: "rgba(108,99,255,0.2)",
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Plus size={22} />
                  </span>
                  <span>Create new project</span>
                </div>

                {/* Project cards */}
                {projects.map((project, idx) => (
                  <div
                    key={project.id}
                    id={`project-card-${project.id}`}
                    className="project-card"
                    style={{ animationDelay: `${idx * 0.06}s` }}
                    onClick={() =>
                      router.push(`/dashboard/projects/${project.id}`)
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) =>
                      e.key === "Enter" &&
                      router.push(`/dashboard/projects/${project.id}`)
                    }
                  >
                    <div className="project-card-icon">
                      <FolderOpen size={22} />
                    </div>
                    <h3 className="project-card-title">{project.title}</h3>
                    <p className="project-card-desc">{project.initialPrompt}</p>
                    <div className="project-card-meta">
                      <Clock size={11} />
                      <span>{formatDate(project.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </main>
      </div>

      {/* New Project Modal */}
      {showModal && (
        <div
          className="modal-overlay"
          onClick={(e) => e.target === e.currentTarget && setShowModal(false)}
        >
          <div className="modal">
            <button
              id="close-modal-btn"
              className="btn btn-icon"
              style={{
                position: "absolute",
                top: 16,
                right: 16,
              }}
              onClick={() => setShowModal(false)}
            >
              <X size={16} />
            </button>

            <h2 className="modal-title">New Project</h2>
            <p className="modal-subtitle">
              Give your project a name and describe what you want to build.
            </p>

            {createError && (
              <div className="alert alert-error">
                <X size={14} />
                {createError}
              </div>
            )}

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label" htmlFor="project-title">
                  Project name
                </label>
                <input
                  id="project-title"
                  type="text"
                  className="form-input"
                  placeholder="e.g. My Portfolio Site"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="project-prompt">
                  Describe what to build
                </label>
                <textarea
                  id="project-prompt"
                  className="form-input"
                  placeholder="Build me a modern portfolio website with a hero section, projects grid, and contact form using React and Tailwind CSS…"
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                  required
                  rows={4}
                  style={{ resize: "vertical" }}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  id="create-project-submit"
                  type="submit"
                  className="btn btn-primary"
                  disabled={creating}
                >
                  {creating ? (
                    <>
                      <span
                        className="spinner"
                        style={{ width: 14, height: 14 }}
                      />
                      Creating…
                    </>
                  ) : (
                    <>
                      <Sparkles size={15} />
                      Create Project
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
