import { createFileRoute } from "@tanstack/react-router";

import { GestureControlPage } from "@/components/dashboard/GestureControlPage";

export const Route = createFileRoute("/dashboard")({
  ssr: false, // uses camera, MediaPipe WASM, localStorage — client only
  head: () => ({
    meta: [
      { title: "Gesture Control · ENGRAM Cortex" },
      { name: "description", content: "Hand-gesture control for the ENGRAM rover." },
    ],
  }),
  component: GestureControlPage,
});
