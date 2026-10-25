import { Reveal } from "@/components/sections/Reveal";

export function BuildSteps() {
  return (
    <section
      id="build"
      className="relative -scroll-mt-10 border-t border-border bg-stage-raised/40 py-24 md:py-32"
    >
      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <Reveal className="mx-auto mb-10 max-w-2xl">
          <h2 className="pb-1 font-display text-4xl font-bold tracking-tight md:text-5xl" style={{ color: "#e8782a" }}>
            What it does.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The rover fetches items, reaches shelves, grabs medication and carries things room to room. You stay in control through hand gestures or voice. Nothing moves without your say.
          </p>
        </Reveal>

        <Reveal>
          <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl">
            <video
              src="/house-vid.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full object-cover"
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
