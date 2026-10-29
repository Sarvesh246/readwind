import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Readwind — A little room to read",
  description:
    "Your books, your thoughts, your place. A quiet reading room, on every device.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
