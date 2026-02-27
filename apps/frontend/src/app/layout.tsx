import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SiteBuilder AI – Build websites with AI",
  description:
    "An AI-powered site builder that creates, edits and deploys websites for you through natural language.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
