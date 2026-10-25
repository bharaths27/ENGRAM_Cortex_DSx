<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules

- Single-page showcase (now just the Hero + BuildSteps sections; PartsExplorer and EngramLoop files are unused) lives at `/` (`src/routes/index.tsx`, `ssr: false`) with sections in `src/components/sections/`; TanStack Router is fixed, so "one page" means one route, not removing the router.
- Must work offline: no remote fonts, scripts, images, HDRs or CDN decoders. Use system font stacks and load the GLB with `useGLTF(url, false, false)` so Draco/Meshopt never fetch from a CDN.
- Model + part list are static files in `public/models/` loaded by relative path (`models/...`, no leading slash).
- Part animation only touches node position (lerp assembled→exploded by t), opacity and emissive on per-part cloned materials (`src/components/rover/useRover.ts`); never edit meshes.
- Part groups, copy, build steps and pure helpers live in `src/lib/rover.ts` with tests in `src/lib/rover.test.ts`.
- Each 3D section has its own Canvas that mounts only near the viewport (geometry is ~2M triangles; keeps GPU memory low on iPad).
- Lighting is exactly one hemisphere + two directional lights, no shadows, DPR capped at 2.
- Heavy client libs (framer-motion, three, R3F, drei, lucide) are listed in `optimizeDeps.include` in vite.config.ts so the dev server never re-optimizes mid-session and serves two React copies.
- `/dashboard` (`src/routes/dashboard.tsx`) is an integration slot (`#dashboard-slot`) for the team's own dashboard; the front page "Next" dives the camera into the computer enclosure, then navigates there.
- Hover picking uses three-mesh-bvh trees built in small timed chunks (`useRoverBvh`) only on hover-capable devices; touch only raycasts on tap.
- vite.config.ts strips the dev-only `data-tsd-source` JSX tag from files that import `@react-three/*`; R3F treats it as a nested prop and crashes on hot updates.
- Front-page rover sits on a glossy reflective floor (`RoverCanvas floor="mirror"`, drei MeshReflectorMaterial with a radial alpha fade over a CSS showroom backdrop); other 3D sections keep the grid floor so only one canvas pays the extra reflection render.
- The brand logo is an inline SVG component (`src/components/brand/EngramLogo.tsx`), not the uploaded PNG, so it stays sharp and offline.
- Hero `ApartFraming` zooms out/lifts the camera by the together/apart value as a delta (keeps user orbit/zoom); `ViewOffset` shift stays constant so parts never cross the text column.
