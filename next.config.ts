import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Gera .next/standalone, usado pelo Dockerfile
  output: "standalone",
};

export default nextConfig;
