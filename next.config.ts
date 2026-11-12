import type { NextConfig } from "next";
import pkg from "./package.json";

// Every deploy gets a unique build id so open apps can detect that a newer
// version is live and offer to refresh.
const build =
  process.env.WORKERS_CI_COMMIT_SHA?.slice(0, 7) ||
  process.env.GITHUB_SHA?.slice(0, 7) ||
  new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_BUILD: build,
  },
};

export default nextConfig;

// Lets `next dev` use Cloudflare bindings locally
import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev()).catch(() => {});
