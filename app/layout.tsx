import type { Metadata, Viewport } from "next";
import "./globals.css";

const tagline = "Read slowly. Wind down.";

export const metadata: Metadata = {
  title: "Readwind",
  description: tagline,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: "/icons/apple-touch-icon-dark-180.png",
  },
  openGraph: {
    title: "Readwind",
    description: tagline,
    images: ["/social/readwind-og-light-1200x630.png"],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2F1EE" },
    { media: "(prefers-color-scheme: dark)", color: "#111111" },
  ],
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
