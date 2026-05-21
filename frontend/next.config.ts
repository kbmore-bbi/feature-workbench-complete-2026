import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const frontendRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  devIndicators: false,
  output: "standalone",
  turbopack: {
    root: frontendRoot,
  },
  async rewrites() {
    const backendOrigin =
      process.env.BACKEND_DEV_ORIGIN ?? "http://127.0.0.1:8000";

    return [
      {
        source: "/api/:path*",
        destination: `${backendOrigin}/api/:path*`,
      },
      {
        source: "/healthz",
        destination: `${backendOrigin}/healthz`,
      },
    ];
  },
};

export default nextConfig;
