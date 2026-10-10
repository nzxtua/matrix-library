import { defineConfig, lazyPlugins } from "vite-plus";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";

const config = defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  // `src/content` is the page's input, not source code: never reformat it.
  fmt: { ignorePatterns: ["src/routeTree.gen.ts", "src/content/**"] },
  lint: {
    ignorePatterns: ["src/routeTree.gen.ts"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  resolve: { tsconfigPaths: true },
  // SPA mode: only the root shell is prerendered; routes render in the browser.
  plugins: lazyPlugins(() => [tanstackStart({ spa: { enabled: true } }), viteReact()]),
});

export default config;
