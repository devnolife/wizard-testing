import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@github/copilot-sdk",
    "better-sqlite3",
    "playwright",
    "playwright-core",
  ],
};

export default nextConfig;
