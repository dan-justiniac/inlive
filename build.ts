import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8")) as { entry: string };
const production = process.argv.includes("--production");

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  loader: { ".css": "text" },
  plugins: [
    {
      name: "chat-client-source",
      setup(build) {
        build.onResolve({ filter: /^chat-client-source$/ }, (args) => ({
          path: args.path,
          namespace: "chat-client-source",
        }));
        build.onResolve({ filter: /^chat-css-source$/ }, (args) => ({
          path: args.path,
          namespace: "chat-css-source",
        }));
        build.onLoad({ filter: /.*/, namespace: "chat-client-source" }, async () => {
          const bundled = await esbuild.build({
            entryPoints: ["src/chatClient.ts"],
            bundle: true,
            write: false,
            format: "iife",
            platform: "browser",
            minify: production,
            logLevel: "silent",
          });
          return {
            contents: `export default ${JSON.stringify(bundled.outputFiles[0]!.text)};`,
            loader: "js",
          };
        });
        build.onLoad({ filter: /.*/, namespace: "chat-css-source" }, () => ({
          contents: `export default ${JSON.stringify(fs.readFileSync("src/chat.css", "utf8"))};`,
          loader: "js",
        }));
      },
    },
  ],
});

await esbuild.build({
  entryPoints: ["src/jsInLiveCliMain.ts"],
  outfile: "dist/js-in-live.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  banner: { js: "#!/usr/bin/env node" },
});
