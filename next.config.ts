import path from "node:path";
import type { NextConfig } from "next";
import { securityHeaders } from "./lib/readwind/security";
const nextConfig: NextConfig = {
  poweredByHeader: false,
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
