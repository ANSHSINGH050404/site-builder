"use client";
export default function Home() {
  // Redirect to /auth on the client
  if (typeof window !== "undefined") {
    window.location.href = "/auth";
  }
  return null;
}
