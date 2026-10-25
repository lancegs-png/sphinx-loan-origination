import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Cache Components / PPR disabled for the prototype: auth'd pages read cookies and
     render dynamically, which is the behavior we want without per-page Suspense/opt-ins. */
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
