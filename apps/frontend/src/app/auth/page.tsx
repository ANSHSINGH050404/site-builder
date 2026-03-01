"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Zap,
  Mail,
  Lock,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
} from "lucide-react";
import { registerUser, loginUser } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

export default function AuthPage() {
  const router = useRouter();
  const setAuthenticated = useAuthStore((s) => s.setAuthenticated);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      if (mode === "register") {
        await registerUser(email, password);
        setSuccess("Account created! Logging you in…");
        await loginUser(email, password);
      } else {
        await loginUser(email, password);
      }
      setAuthenticated(true);
      router.push("/dashboard");
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.details?.[0]?.message ||
        "Something went wrong. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-bg-orb orb1" />
      <div className="auth-bg-orb orb2" />

      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Zap size={20} color="#fff" strokeWidth={2.5} />
          </div>
          <span className="auth-logo-text">SiteBuilder AI</span>
        </div>

        {/* Heading */}
        <h1 className="auth-title">
          {mode === "login" ? "Welcome back" : "Get started"}
        </h1>
        <p className="auth-subtitle">
          {mode === "login"
            ? "Sign in to your account to continue"
            : "Create an account to start building"}
        </p>

        {/* Alerts */}
        {error && (
          <div className="alert alert-error">
            <AlertCircle size={15} />
            {error}
          </div>
        )}
        {success && (
          <div className="alert alert-success">
            <CheckCircle2 size={15} />
            {success}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">
              <Mail size={12} style={{ display: "inline", marginRight: 4 }} />
              Email address
            </label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group relative">
            <label className="form-label" htmlFor="password">
              <Lock size={12} style={{ display: "inline", marginRight: 4 }} />
              Password
            </label>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              className="form-input"
              placeholder={
                mode === "register"
                  ? "At least 8 characters"
                  : "Enter your password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />

            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>

          <button
            id="auth-submit-btn"
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ width: 16, height: 16 }} />
                {mode === "login" ? "Signing in…" : "Creating account…"}
              </>
            ) : mode === "login" ? (
              "Sign in"
            ) : (
              "Create account"
            )}
          </button>
        </form>

        {/* Switch */}
        <div className="auth-switch">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <a
                id="switch-to-register"
                onClick={() => {
                  setMode("register");
                  setError("");
                  setSuccess("");
                }}
              >
                Sign up
              </a>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <a
                id="switch-to-login"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setSuccess("");
                }}
              >
                Sign in
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
