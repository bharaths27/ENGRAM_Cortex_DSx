// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

/**
 * Dev only: the TanStack devtools plugin tags every JSX element with `data-tsd-source`.
 * React Three Fiber treats that as a nested property path (`data.tsd-source`) on 3D objects
 * and throws on update ("R3F: Cannot set data-tsd-source"), blanking the page after edits.
 * Runs right after the devtools transform and strips the tag from files that use R3F.
 */
function stripDevSourceFromR3F(): Plugin {
  return {
    name: "engram:strip-tsd-source-from-r3f",
    enforce: "pre",
    apply: "serve",
    transform(code, id) {
      if (id.includes("node_modules") || !/\.[jt]sx(\?|$)/.test(id)) return;
      if (!code.includes("data-tsd-source") || !code.includes("@react-three/")) return;
      return { code: code.replace(/\s+data-tsd-source="[^"]*"/g, ""), map: null };
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [stripDevSourceFromR3F()],
    // Pre-bundle the 3D/animation libs at startup together with React. If they are only
    // discovered at runtime, the dev server re-optimizes mid-session and the browser can end
    // up with two React copies ("Cannot read properties of null (reading 'useContext')").
    optimizeDeps: {
      include: [
        "framer-motion",
        "three",
        "@react-three/fiber",
        "@react-three/drei",
        "lucide-react",
      ],
    },
  },
});
