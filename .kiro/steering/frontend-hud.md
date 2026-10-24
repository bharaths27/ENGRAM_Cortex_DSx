---
inclusion: fileMatch
fileMatchPattern: "web/**"
---
# HUD design rules (steering, loaded when editing web/)

- Aesthetic: calm, polished dark "control room" HUD in a silver / dark-grey / grey palette
  with a single comfortable orange accent. No neon sci-fi treatment.

## Palette

Use these ten named entries. Every visible color should come from one of them.

- background: `#16171A`
- panel: `#202226`
- raised: `#2A2D32`
- border: `rgba(210,214,220,0.10)`
- silver text: `#DADDE2`
- muted text: `#8A9099`
- orange: `#E8915A`
- sage: `#8FBF9A`
- soft red: `#D96A6A`
- steel: `#A9B4C2`

## Semantic color meaning

Keep these four roles consistent; each maps to exactly one palette entry.

- primary / attention → orange
- verified → sage
- stop / abstain → soft red
- info / skill → steel

## Motion

- Use ease-out timing with a transition duration between 200 ms and 400 ms.
- No neon glow. No scanlines. No glitch distortion. No full-screen flash.
- The `prefers-reduced-motion` preference must be honored: disable decorative/looping
  animation and present state in its final position when reduced motion is active.

## Preserved rules

- Do not use any movie or comic franchise names, logos or character names in the UI.
- Approvals use a deliberate 0.8 s hold, never a single tap.
- Every status shown must come from the server. Never animate a fake success.
- Layout targets iPad landscape 1180x820 and portrait; phone width stacks columns.
