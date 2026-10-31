import type { Metadata, Viewport } from "next";
import { Providers } from "./providers";
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
    { media: "(prefers-color-scheme: light)", color: "#efe8da" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1511" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
