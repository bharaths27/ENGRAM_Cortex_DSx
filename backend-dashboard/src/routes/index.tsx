import { createFileRoute } from "@tanstack/react-router";
import { MotionConfig } from "framer-motion";

import { EngramLogo } from "@/components/brand/EngramLogo";
import { BuildSteps } from "@/components/sections/BuildSteps";
import { Hero } from "@/components/sections/Hero";

export const Route = createFileRoute("/")({
  ssr: false, // WebGL canvases must never render on the server
  head: () => ({
    meta: [
      { title: "ENGRAM Assist · Robotic help for people with mobility challenges" },
      {
        name: "description",
        content:
          "Gesture and voice controlled robotic assistant for people with disabilities. Explore it in 3D.",
      },
      { property: "og:title", content: "ENGRAM Assist" },
      {
        property: "og:description",
        content: "Hands-free robotic assistance for people with mobility challenges.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <MotionConfig reducedMotion="user">
      <header className="fixed inset-x-0 top-0 z-[45] border-b border-border bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 md:px-10">
          <a
            href="#rover"
            className="flex min-h-[48px] items-center"
            aria-label="ENGRAM Cortex, back to top"
          >
            <EngramLogo animate />
          </a>
        </div>
      </header>
      <main>
        <Hero />
        <BuildSteps />
      </main>
      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 font-mono text-xs uppercase tracking-widest text-muted-foreground md:px-10">
          <span>ENGRAM Assist</span>
          <span>Independence through technology</span>
        </div>
      </footer>
    </MotionConfig>
  );
}
