import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Classic request-time rendering: nearly every page here is per-user / per-tenant, and buyers
  // customising the code shouldn't have to learn Cache Components' Suspense rules.
  cacheComponents: false,
  // Long-lived server packages are loaded from node_modules instead of bundled
  serverExternalPackages: ["pg-boss", "socket.io", "@prisma/adapter-pg", "@whiskeysockets/baileys"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
