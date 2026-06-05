import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const test = mode === "test" || Boolean(process.env.VITEST);
  return {
    cacheDir: test ? "node_modules/.vite-test" : "node_modules/.vite-dev",
    server: {
      host: "127.0.0.1",
      ...(test ? {} : {
        port: 15173,
        strictPort: true,
        proxy: {
          "/inlive-dev": "http://127.0.0.1:15174",
        },
      }),
    },
    test: {
      include: ["test/**/*.test.ts"],
      exclude: ["node_modules", "dist", "src/generated"],
      pool: "forks",
    },
  };
});
