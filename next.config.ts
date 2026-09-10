import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Arena/E2B preview proxies the app through https://3000-<sandbox>.e2b.app;
  // without this, Next dev blocks cross-origin dev resources (webpack HMR) from
  // that host. No effect in production builds.
  allowedDevOrigins: ["*.e2b.app"],
};

export default nextConfig;
