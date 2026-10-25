import { motion } from "framer-motion";

import { INNER_RING_ANGLE, LOGO_RINGS } from "@/components/brand/EngramLogo";

/** Total length of the unlock, in seconds. */
export const UNLOCK_SECONDS = 2.6;

/** Shared timeline (fractions of UNLOCK_SECONDS) so every ring stays in step. */
const T = {
  shown: 0.16, // logo has zoomed in out of the black
  spun: 0.58, // dial turns finished (with a small back-turn like a combination lock)
  open: 0.7, // rings spring open, core flashes
  hold: 0.78,
};

const ring = { transformBox: "fill-box", transformOrigin: "center" } as const;
const dialEase = [0.65, 0, 0.35, 1] as const;

/**
 * The ENGRAM CORTEX logo zooms in on the black screen, its rings turn in opposite
 * directions like a combination lock, click open, and the view pushes through the core.
 */
export function LogoUnlock({ onDone }: { onDone: () => void }) {
  const d = UNLOCK_SECONDS;
  return (
    <motion.div
      className="size-[min(44vh,44vw)]"
      initial={{ scale: 0.35, opacity: 0 }}
      animate={{ scale: [0.35, 1, 1, 1.06, 1, 9], opacity: [0, 1, 1, 1, 1, 0] }}
      transition={{ duration: d, times: [0, T.shown, T.spun, T.open, T.hold, 1], ease: "easeInOut" }}
      onAnimationComplete={onDone}
      aria-hidden
    >
      <svg viewBox="0 0 48 48" className="size-full" fill="none">
        {/* Outer dashed ring: clockwise, overshoots, then settles back a notch. */}
        <motion.g
          style={ring}
          initial={{ rotate: 0 }}
          animate={{ rotate: [0, 0, 250, 210, 210], scale: [1, 1, 1, 1.08, 1.08] }}
          transition={{ duration: d, times: [0, 0.08, 0.42, T.spun, 1], ease: dialEase }}
        >
          <circle cx="24" cy="24" {...LOGO_RINGS.outer} strokeLinecap="round" />
        </motion.g>

        {/* Inner broken ring: counter-clockwise, then lines its gap up to "unlock". */}
        <motion.g
          style={ring}
          initial={{ rotate: INNER_RING_ANGLE }}
          animate={{
            rotate: [
              INNER_RING_ANGLE,
              INNER_RING_ANGLE,
              INNER_RING_ANGLE - 300,
              INNER_RING_ANGLE - 270,
              INNER_RING_ANGLE - 270,
            ],
            scale: [1, 1, 1, 1.14, 1.14],
          }}
          transition={{ duration: d, times: [0, 0.1, 0.46, T.spun + 0.04, 1], ease: dialEase }}
        >
          <circle cx="24" cy="24" {...LOGO_RINGS.inner} strokeLinecap="round" />
        </motion.g>

        {/* Thin ring around the core: turns clockwise again, opposite to the inner ring. */}
        <motion.g
          style={ring}
          animate={{ rotate: [0, 0, 180, 180] }}
          transition={{ duration: d, times: [0, 0.12, T.spun, 1], ease: dialEase }}
        >
          <circle cx="24" cy="24" {...LOGO_RINGS.coreRing} strokeDasharray="9 1.4" />
        </motion.g>

        {/* Core: flashes brighter when the lock opens. */}
        <motion.circle
          cx="24"
          cy="24"
          {...LOGO_RINGS.core}
          style={ring}
          animate={{ scale: [1, 1, 1.3, 1], opacity: [0.85, 0.85, 1, 1] }}
          transition={{ duration: d, times: [0, T.spun, T.open, T.hold], ease: "easeOut" }}
        />
      </svg>
    </motion.div>
  );
}
