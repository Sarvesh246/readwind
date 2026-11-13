import path from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./lib/readwind/security";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  compress: true,
  // Barrel-heavy packages: import only the icons/primitives actually used.
  experimental: {
    optimizePackageImports: ["lucide-react", "radix-ui", "motion"],
  },
  turbopack: {
    resolveAlias: {
      fs: { browser: "./lib/readwind/empty-module.ts" },
      path: { browser: "./lib/readwind/empty-module.ts" },
    },
  },
  adapterPath: path.resolve("scripts/offline-next-adapter.mjs"),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: Object.entries(securityHeaders).map(([key, value]) => ({
          key,
          value,
        })),
      },
    ];
  },
};
export default nextConfig;
