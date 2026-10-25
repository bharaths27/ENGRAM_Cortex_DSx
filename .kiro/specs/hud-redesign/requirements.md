# Requirements Document

## Introduction

This feature is a visual restyle and motion refresh of the ENGRAM Cortex iPad operator console, confined to the `web/` front end (`index.html`, `css/hud.css`, `js/app.js`, `js/fx.js`) plus the HUD steering file. The current interface is a cyan/amber sci-fi HUD built on neon glow, scanlines, full-screen flashes, and a glitch effect. This redesign replaces that treatment with a calmer, polished "control room" aesthetic in a silver / dark-grey / grey palette accented by a single comfortable orange, with lively-but-smooth motion that honors reduced-motion preferences.

This is a styling and motion change only. No observable behavior of the console changes: every command path, approval flow, WebSocket handler, canvas render, drawer, toast, and status chip must continue to function exactly as it does today. The HTML structure keeps every element `id` and class hook that `js/app.js` and `js/voice.js` query, the `FX` module keeps every public function signature so existing calls never throw, and the Python `server/` code is not touched. Canvas-drawn graphics in `app.js` (camera overlay and LiDAR radar) currently use hardcoded cyan/amber/green RGB values plus `shadowBlur` glow; those color literals are remapped to the new palette and the glow is removed, but the drawing logic and all data bindings stay identical.

## Glossary

- **Console**: The ENGRAM Cortex web front end served from `web/`, comprising `index.html`, `css/hud.css`, `js/app.js`, `js/fx.js`, and `js/voice.js`.
- **Stylesheet**: The file `web/css/hud.css`.
- **App_Script**: The file `web/js/app.js`, which renders canvas graphics and DOM content.
- **FX_Module**: The visual/audio effects module defined in `web/js/fx.js` and exposed on `window.FX`.
- **Steering_File**: The existing file `.kiro/steering/frontend-hud.md` that documents HUD design rules.
- **Palette_Token**: A CSS custom property declared in the Stylesheet `:root` block that holds one of the defined redesign colors.
- **Semantic_Color**: A palette color assigned a fixed interpreted meaning (orange = primary/attention, sage = verified, soft red = stop/abstain, steel = info/skill).
- **Reactor**: The animated boot SVG rings and core (`.reactor` with `.r`, `.core`, `.spokes`) on the boot screen.
- **Status_Dot**: A connection/health indicator rendered as `.chip i` in the top bar.
- **Radar**: The LiDAR sweep canvas `#radar`, drawn by the `drawRadar` function in App_Script.
- **Camera_Overlay**: The target-lock/telemetry canvas `#cam-overlay`, drawn by the `drawOverlay` function in App_Script.
- **Step_List**: The ordered plan step list `.steps` / `.step` rendered inside the PLAN panel.
- **Hold_Button**: The deliberate hold-to-approve control `#hold` with its `.fill` progress element.
- **Scoreboard**: The RUN SCOREBOARD panel body `#score-body` containing the `.sc-grid` metric grid.
- **Evidence_Drawer**: The slide-in panel `#drawer` with scrim `#scrim`.
- **Toast**: The transient message element `#toast`, driven by `FX.toast`.
- **Banner**: The large transient headline element `#banner`, driven by `FX.banner`.
- **Flash_Effect**: The full-screen overlay `#fx-flash` toggled by `FX.flash`.
- **Glitch_Effect**: The screen-distortion effect triggered by `FX.glitch` via the `body.glitch` class.
- **Scanline_Layer**: The overlay element `#fx-scan` that currently renders repeating scanlines.
- **Reduced_Motion**: The user environment state reported by the CSS media feature `prefers-reduced-motion: reduce`.
- **External_Resource**: Any asset or reference loaded from a network location outside the served `web/` directory, including CDNs, web fonts, and any absolute `http`/`https`/protocol-relative URL.

## Requirements

### Requirement 1: Palette Token Definition

**User Story:** As an operator, I want the console to use a calm silver/grey palette with one orange accent, so that the interface reads as a polished control room instead of a neon sci-fi display.

#### Acceptance Criteria

1. THE Stylesheet SHALL declare Palette_Tokens for background `#16171A`, panel `#202226`, raised surface `#2A2D32`, and border `rgba(210,214,220,0.10)`.
2. THE Stylesheet SHALL declare Palette_Tokens for silver text `#DADDE2` and muted text `#8A9099`.
3. THE Stylesheet SHALL declare Palette_Tokens for primary orange `#E8915A`, orange hover `#F0A574`, and orange soft tint `rgba(232,145,90,0.14)`.
4. THE Stylesheet SHALL declare Palette_Tokens for verified sage `#8FBF9A`, stop/abstain soft red `#D96A6A`, and info/skill steel `#A9B4C2`.
5. WHERE a visible foreground, background, border, or fill color is applied to a Console surface, text, border, or control, THE Stylesheet SHALL source that color value from a defined Palette_Token rather than an inline literal.
6. THE Stylesheet SHALL set the document background to the background Palette_Token and the default body text color to the silver text Palette_Token.
7. IF a style references a Palette_Token that is not defined in the `:root` block, THEN THE Stylesheet SHALL be considered non-conforming.

### Requirement 2: Semantic Color Usage

**User Story:** As an operator, I want each color to carry a consistent meaning, so that I can read system state at a glance without misinterpreting a cue.

#### Acceptance Criteria

1. WHERE a Console control represents a primary action or a state that needs operator attention, including the Hold_Button, its `.fill` element, and warning-state chips and steps, THE Stylesheet SHALL set that element's foreground, fill, or border color to the primary orange Palette_Token.
2. WHERE a Console element represents a verified outcome, including succeeded steps and success-variant Toast and Banner states, THE Stylesheet SHALL set that element's foreground, fill, or border color to the verified sage Palette_Token.
3. WHERE a Console element represents a stop, veto, or abstain state, including the reject control, the `bad` chip state, and vetoed, stopped, rejected, or failed steps, THE Stylesheet SHALL set that element's foreground, fill, or border color to the soft red Palette_Token.
4. WHERE a Console element represents informational status or a learned skill, including the `ok` chip state and skill items, THE Stylesheet SHALL set that element's foreground, fill, or border color to the steel Palette_Token.
5. WHERE two or more Console element classes share the same Semantic_Color meaning, THE Stylesheet SHALL assign all of them the identical Palette_Token for that meaning.
6. THE Stylesheet SHALL assign each of the primary orange, verified sage, soft red, and steel Palette_Tokens to exactly one Semantic_Color meaning, using no one of these four tokens to convey two different meanings.

### Requirement 3: Offline, No External Resources

**User Story:** As an operator running the robot on an isolated iPad, I want the console to load with no internet access, so that the demo works fully offline.

#### Acceptance Criteria

1. WHEN the Console is loaded with no network connectivity, THE Console SHALL render all redesigned styles and scripts to visual completion within 3 seconds without issuing any request to an External_Resource.
2. THE Stylesheet SHALL specify every typeface using only system font stacks or font files served from within the `web/` directory, with no reference to any remote web font service.
3. THE Console SHALL contain no reference to a CDN, no reference to a web font service, and no absolute `http`, `https`, or protocol-relative (`//`) URL for any styling, scripting, or layout asset.
4. WHERE a decorative asset is used by the redesign, THE Console SHALL provide that asset either inline within the served document or as a file served from within the `web/` directory.
5. IF any styling, scripting, or layout asset fails to load from a local or inline source, THEN THE Console SHALL render using its locally available fallback styles and SHALL NOT issue a request to any External_Resource to retrieve the missing asset.

### Requirement 4: Smooth, Non-Neon Motion

**User Story:** As an operator, I want motion that is lively but smooth and free of harsh effects, so that the console feels responsive without being distracting or straining to read.

#### Acceptance Criteria

1. WHERE the redesign applies a transition to a Console element, THE Stylesheet SHALL use an ease-out timing function with a duration between 200 ms and 400 ms inclusive.
2. THE Stylesheet SHALL render Console elements without neon glow, defining no `box-shadow`, `text-shadow`, or canvas glow that produces a luminous halo effect.
3. THE Console SHALL render no scanline overlay.
4. THE Console SHALL render no glitch distortion effect.
5. THE Console SHALL render no full-screen color flash overlay.
6. WHILE a Console transition or animation is playing, THE Stylesheet SHALL hold the per-frame opacity change at or below 0.25 so that no element flashes or flickers.

### Requirement 5: Reduced-Motion Support

**User Story:** As an operator sensitive to motion, I want the console to respect my reduced-motion setting, so that non-essential animation is minimized.

#### Acceptance Criteria

1. WHILE Reduced_Motion is active, THE Stylesheet SHALL disable all continuous, looping, or decorative animations on Console elements and limit any remaining state-change transition to a duration of 100 milliseconds or less.
2. WHILE Reduced_Motion is active, THE Console SHALL continue to render the current server-reported state on every affected element within 500 milliseconds of receiving each state update.
3. WHILE Reduced_Motion is active, THE Radar sweep SHALL present its current data as a static or discretely updated view with no continuous sweep animation, and THE Camera_Overlay SHALL present its current data with no continuous decorative motion.
4. WHEN the operator's reduced-motion system preference changes to active while the Console is displayed, THE Console SHALL apply the Reduced_Motion behavior defined in criteria 1 through 3 within 1 second without requiring a page reload.

### Requirement 6: Boot Reactor Restyle

**User Story:** As an operator, I want the boot screen to show a soft orange-and-silver reactor, so that startup feels polished and on-brand with the new palette.

#### Acceptance Criteria

1. THE Stylesheet SHALL render the Reactor rings and core using only colors defined in the orange and silver Palette_Tokens, with no color values outside the Palette_Tokens set applied to the Reactor.
2. WHEN the boot screen is displayed, THE Stylesheet SHALL animate the Reactor rings with continuous rotation at a constant angular speed completing one full 360-degree revolution within 4 to 12 seconds per ring.
3. WHEN the boot screen is displayed, THE Stylesheet SHALL animate the Reactor core with a repeating pulse that varies opacity or scale between a minimum and maximum bound over a cycle duration of 1.5 to 4 seconds.
4. THE Stylesheet SHALL render the Reactor without any glow effect exceeding a blur radius of 4 pixels.
5. WHILE Reduced_Motion is active, THE Stylesheet SHALL hold the Reactor rings and core in a fixed position with no rotation and limit any remaining animation to opacity changes completing no more than one cycle every 4 seconds.

### Requirement 7: Staggered Panel Entrance

**User Story:** As an operator, I want panels to ease in during boot, so that the interface assembles in a calm, ordered way.

#### Acceptance Criteria

1. WHEN the HUD enters its live state, THE Stylesheet SHALL animate each `.panel-in` element from a hidden start state (reduced opacity, offset, or scale) to its final state (full opacity, no offset, no scale).
2. THE Stylesheet SHALL order the panel entrances so that each `.panel-in` element's start delay increases monotonically with its `--d` value, such that no two consecutive panels in `--d` order start at the same instant.
3. THE Stylesheet SHALL perform each panel entrance as a single ease-out transition with a per-panel duration between 200 ms and 800 ms.
4. IF a `.panel-in` element has no `--d` value set, THEN THE Stylesheet SHALL animate it into view using a default stagger order without error.
5. WHILE Reduced_Motion is active, THE Stylesheet SHALL present panels in their final position, with any residual transition completing within 10 ms.

### Requirement 8: Breathing Status Dots

**User Story:** As an operator, I want the status indicators to breathe gently, so that I can tell the console is live without a jarring blink.

#### Acceptance Criteria

1. WHEN a Status_Dot is rendered, THE Stylesheet SHALL animate it with a repeating breathing cycle that varies opacity between 0.4 and 1.0 over a cycle duration of 3 to 5 seconds.
2. THE Stylesheet SHALL animate the Status_Dot breathing continuously as an indefinite loop with no visible restart jump, changing opacity by no more than 0.1 per 100 milliseconds.
3. THE Stylesheet SHALL color each Status_Dot according to its Semantic_Color meaning, applying the steel (info) Palette_Token to the `ok` state, the orange (attention) Palette_Token to the `warn` state, and the soft red Palette_Token to the `bad` state.
4. WHILE Reduced_Motion is active, THE Stylesheet SHALL render Status_Dots at a fixed opacity of 1.0 with no breathing animation.

### Requirement 9: LiDAR Radar Restyle

**User Story:** As an operator, I want the LiDAR radar to keep its sweep and point plotting in the new palette, so that obstacle data stays legible and matches the redesign.

#### Acceptance Criteria

1. WHEN the App_Script renders a Radar frame, THE App_Script SHALL draw the Radar grid, sweep, obstacle points, veto zone, and robot glyph using colors drawn exclusively from the redesign Palette_Tokens, with no color literal outside Palette_Tokens.
2. WHEN the App_Script draws Radar obstacle points, THE App_Script SHALL render each point with a blur radius of 0 (no shadowBlur glow).
3. WHEN the App_Script draws a Radar obstacle point whose measured distance is below the 20 cm veto threshold, THE App_Script SHALL color that point with the soft red Palette_Token.
4. WHEN the App_Script draws a Radar obstacle point whose measured distance is at or above 20 cm and below the 40 cm warning threshold, THE App_Script SHALL color that point with the orange Palette_Token.
5. WHEN the App_Script renders a Radar frame, THE App_Script SHALL preserve the existing Radar sweep animation, sector-to-angle mapping, and distance-to-radius scaling such that, for identical obstacle input, point and sweep positions are pixel-identical to the pre-restyle output.
6. WHILE Reduced_Motion is active, THE Radar SHALL display a static snapshot of the current obstacle data with no continuously rotating sweep, and SHALL update that snapshot WHEN new obstacle data arrives.

### Requirement 10: Camera Target-Lock Overlay Restyle

**User Story:** As an operator, I want the camera target-lock brackets to use the new palette, so that detected tags remain clear without neon glow.

#### Acceptance Criteria

1. WHEN the App_Script renders a Camera_Overlay frame, THE App_Script SHALL draw the crosshair, pitch ticks, non-locked detection brackets, labels, and telemetry readouts using colors mapped to the redesign Palette_Tokens, with no legacy neon color values remaining.
2. WHILE a detection matches the active locked target, THE App_Script SHALL draw that detection's target bracket and surrounding ring using the orange Palette_Token.
3. WHILE no detection matches the active locked target, THE App_Script SHALL draw each detection bracket using the default (non-orange) detection Palette_Token.
4. WHEN the App_Script renders any Camera_Overlay element, THE App_Script SHALL draw it with the canvas shadow-blur radius set to 0 so that no glow is applied to any overlay element.
5. WHEN the App_Script renders the Camera_Overlay, THE App_Script SHALL preserve the existing detection-bracket corner geometry, the locked-target pulse animation, the rotating locked-target ring, the per-detection label and sub-label text content, the locked-target "TARGET LOCK" indicator text, and the telemetry readout content, changing only their colors to the Palette_Tokens.

### Requirement 11: Plan Step List With Progress Line

**User Story:** As an operator, I want the plan steps to show an animated progress line in the new palette, so that I can follow execution progress smoothly.

#### Acceptance Criteria

1. THE Stylesheet SHALL render the Step_List connector line and step dots using the redesign Palette_Tokens.
2. WHEN a step enters the Step_List, THE Stylesheet SHALL animate its entrance using an ease-out transition between 200 ms and 400 ms, preserving the existing `--i` stagger.
3. WHILE a step is in the running status, THE Stylesheet SHALL indicate that step with a continuous animated cue whose single cycle completes between 800 ms and 2000 ms and that defines no `box-shadow`, `text-shadow`, or glow producing a luminous halo.
4. THE Stylesheet SHALL color the running, succeeded, and skipped step statuses using the primary orange, verified sage, and steel Palette_Tokens respectively.
5. THE Stylesheet SHALL color the failed, vetoed, stopped, and rejected step statuses using the soft red Palette_Token, and the unknown step status using the steel Palette_Token.
6. WHILE Reduced_Motion is active, THE Stylesheet SHALL present each step in its final visual state with no entrance transition and no running-step cue animation.

### Requirement 12: Hold-To-Approve Fill

**User Story:** As an operator, I want the approval control to require a deliberate hold with a clear fill, so that a stray tap can never authorize robot motion.

#### Acceptance Criteria

1. THE Stylesheet SHALL render the Hold_Button and its `.fill` progress element using the primary orange Palette_Token.
2. WHILE the operator maintains continuous contact with the Hold_Button, THE Console SHALL require an uninterrupted hold of 800 ms before authorizing robot motion, and THE App_Script SHALL drive the fill progress from 0 percent at hold start to 100 percent at 800 ms elapsed.
3. IF contact with the Hold_Button is released before 800 ms of continuous hold elapse, THEN THE Console SHALL cancel the approval, withhold authorization of robot motion, and THE App_Script SHALL reset the fill progress to 0 percent.
4. WHEN the operator holds the Hold_Button, THE Stylesheet SHALL advance the `.fill` progress element continuously in proportion to elapsed hold time with no neon glow effect applied.
5. THE Stylesheet SHALL render the Hold_Button using the primary action Palette_Token and the reject control using the stop Palette_Token so the two controls use distinct, non-identical Palette_Token values.

### Requirement 13: Softer Toasts and Banners

**User Story:** As an operator, I want toasts and banners to appear softly in the new palette, so that notifications are noticeable without being harsh.

#### Acceptance Criteria

1. THE Stylesheet SHALL render the Toast and Banner using the redesign Palette_Tokens with no neon glow, applying zero box-shadow blur attributable to glow effects.
2. WHEN a Toast or Banner appears or is dismissed, THE Stylesheet SHALL animate the transition using an ease-out timing function with a duration between 200 ms and 400 ms inclusive.
3. THE Stylesheet SHALL color Toast and Banner variants according to their Semantic_Color meaning, applying the verified sage Palette_Token to success variants, the orange Palette_Token to attention variants, and the soft red Palette_Token to stop/abstain variants.
4. THE FX_Module SHALL preserve the `FX.toast` and `FX.banner` function signatures, accepting the same parameter names, count, and order as the existing App_Script calls, so that existing calls continue to display messages without modification.
5. IF an App_Script call to `FX.toast` or `FX.banner` passes a variant value outside the defined success, attention, and stop/abstain set, THEN THE FX_Module SHALL render the message using a default variant and SHALL display the message without raising an error.
6. WHILE Reduced_Motion is active, THE Stylesheet SHALL show and hide the Toast and Banner without any sliding or scaling entrance or exit animation, changing only opacity or visibility.

### Requirement 14: Button Hover and Press States

**User Story:** As an operator, I want every button to react to hover and press, so that the interface feels responsive and I get clear feedback on touch.

#### Acceptance Criteria

1. WHEN a pointer hovers over a Console button, THE Stylesheet SHALL apply a hover state using the orange hover or soft tint Palette_Token with a transition duration within the 200 ms to 400 ms motion range.
2. WHEN a Console button is pressed, THE Stylesheet SHALL apply a press state with a transition duration within the 200 ms to 400 ms motion range.
3. WHEN a pointer is released after pressing a Console button, THE Stylesheet SHALL remove the press state and return the button to its hover state if the pointer remains over the button or its default state otherwise, within the 200 ms to 400 ms motion range.
4. THE Stylesheet SHALL apply hover and press states to every interactive button in the Console, including quick commands, icon buttons, approval and verification controls, drawer controls, and the simulator control.
5. THE Stylesheet SHALL render button hover and press states without neon glow.
6. WHILE a Console button is in a disabled state, THE Stylesheet SHALL suppress both hover and press state styling and SHALL render the button in a visually muted disabled appearance using the muted text Palette_Token.

### Requirement 15: Scoreboard Number Count-Up

**User Story:** As an operator, I want measured run metrics to count up when they appear, so that updated numbers draw my eye without looking fabricated.

#### Acceptance Criteria

1. WHEN the Scoreboard renders a numeric metric value, THE App_Script SHALL animate that value counting up from the metric row's previously displayed numeric value, or from zero when no prior value existed, to its final server-reported value.
2. THE App_Script SHALL complete each Scoreboard count-up within the 200 ms to 400 ms motion range.
3. THE App_Script SHALL display the final Scoreboard value equal to the measured server-reported value, animating no value that the server did not report.
4. WHILE Reduced_Motion is active, THE App_Script SHALL display Scoreboard values immediately without the count-up animation.
5. THE App_Script SHALL preserve the existing Scoreboard run-comparison logic and metric rows.
6. IF a Scoreboard metric value is missing or non-numeric, THEN THE App_Script SHALL display the existing placeholder for that metric without animating a count-up.
7. WHEN a new server-reported value arrives for a Scoreboard metric while its count-up animation is in progress, THE App_Script SHALL cancel the in-progress animation and start a new count-up to the new value.

### Requirement 16: Evidence Drawer Expand

**User Story:** As an operator, I want the evidence drawer to slide open smoothly, so that reviewing a citation feels polished and unobtrusive.

#### Acceptance Criteria

1. WHEN the Evidence_Drawer opens, THE Stylesheet SHALL animate it into view with an ease-out transition completing within the 200 ms to 400 ms motion range.
2. WHEN the Evidence_Drawer closes, THE Stylesheet SHALL animate it out of view with an ease-out transition completing within the 200 ms to 400 ms motion range.
3. WHEN the Evidence_Drawer opens or closes, THE Stylesheet SHALL fade the scrim `#scrim` between fully transparent and its visible opacity over the same duration as the Evidence_Drawer transition.
4. WHILE Reduced_Motion is active, THE Stylesheet SHALL show and hide the Evidence_Drawer and the scrim `#scrim` instantly with no slide or fade transition.
5. THE Stylesheet SHALL render the Evidence_Drawer surfaces using the panel and raised Palette_Tokens.

### Requirement 17: Preserved Element Identifiers and Hooks

**User Story:** As a developer, I want every DOM hook that the scripts rely on to stay intact, so that the redesign changes only appearance and never breaks behavior.

#### Acceptance Criteria

1. THE Console SHALL retain exactly one element bearing each of the following `id` values queried by App_Script and `js/voice.js`, such that a `document.getElementById` lookup for each returns a non-null element: `engage`, `boot`, `boot-log`, `hud`, `cam`, `cam-overlay`, `cam-msg`, `cam-meta`, `radar`, `radar-meta`, `veto`, `tape`, `heard`, `cmd`, `cmd-form`, `cmd-hint`, `mic`, `wave`, `quick`, `plan-body`, `plan-meta`, `plan-actions`, `hold`, `ttl-fg`, `ttl-t`, `reject`, `mem-body`, `mem-meta`, `skills-body`, `skills-meta`, `score-body`, `log`, `log-meta`, `drawer`, `drawer-title`, `drawer-body`, `drawer-x`, `scrim`, `toast`, `banner`, `stop`, `stop-clear`, `clock`, `chip-net`, `chip-link`, `chip-robot`, `chip-lidar`, `chip-model`, `chip-sim`, `sim-ctl`, `sim-obst`, `btn-mute`, `btn-teach`, `fx-scan`, `fx-vignette`, and `fx-flash`.
2. THE Console SHALL retain one `template` element with `id` `teach-tpl` whose content contains exactly one element with each of the `id` values `t-text`, `t-tag`, `t-zone`, and `t-trig`, such that each is reachable after the template content is cloned into the DOM.
3. WHEN App_Script sets, toggles, or queries a class selector or element structure to render content, THE Console SHALL provide a matching element for each such selector, including the status chip class `chip`, the abstain and clarify classes `abst` and `clar`, the option classes `opts` and `tag`, the operation classes `op-goal` and `op-sub`, the outcome classes `outcome` and `bad`, and the log list item under the element with `id` `log`, such that the corresponding query returns a non-null element or node list.
4. WHEN App_Script toggles the `estop` class on `document.body` or FX_Module toggles the `glitch` class on `document.body`, THE Console SHALL apply the toggle without raising an uncaught script exception and without logging an error to the browser console.
5. WHEN a developer loads the Console and completes the boot sequence, THE Console SHALL expose every `id` listed in criterion 1 and every class selector listed in criterion 3 as present in the DOM, such that a presence check over the full list reports zero missing hooks.

### Requirement 18: Neutralized Flash and Glitch Effects

**User Story:** As a developer, I want the harsh flash and glitch effects neutralized while their trigger functions stay callable, so that the scripts keep working without logic changes.

#### Acceptance Criteria

1. THE FX_Module SHALL retain the `FX.flash` function accepting one optional color argument and the `FX.glitch` function accepting no required arguments.
2. WHEN App_Script calls `FX.flash` with any argument, THE FX_Module SHALL complete without throwing an error.
3. WHEN `FX.flash` is called, THE Console SHALL produce no full-screen color flash, changing no pixel color outside the bounds of an individual panel via the Flash_Effect element `#fx-flash`.
4. WHEN App_Script calls `FX.glitch`, THE FX_Module SHALL complete without throwing an error and SHALL leave the `body.glitch` toggle operable for other styling.
5. WHEN `FX.glitch` is called, THE Console SHALL produce no screen distortion, applying no positional shift, duplication, color separation, or skew to Console content.
6. WHERE a state change previously triggered a flash, THE Console SHALL present at most a cue confined to a single panel's bounds, changing no pixel color outside that panel.
7. THE Console SHALL render the Scanline_Layer element `#fx-scan` either removed or fully transparent so that it alters no pixel color and produces no visible scanlines.

### Requirement 19: Server Code Untouched

**User Story:** As a developer, I want the redesign confined to the front end, so that server behavior and contracts are unaffected.

#### Acceptance Criteria

1. THE redesign SHALL modify only files located within the `web/` directory and the Steering_File `.kiro/steering/frontend-hud.md`, and SHALL NOT create, modify, or delete any other file in the repository.
2. THE redesign SHALL make no change to the contents of any file under the `server/` directory.
3. WHEN the Console issues a request to a server endpoint, THE Console SHALL use only the HTTP endpoints, request methods, and request payload shapes defined in the existing server contract without adding, removing, or altering any endpoint or request field.
4. WHEN the Console receives a WebSocket event or an HTTP response, THE Console SHALL consume only the event names and response field shapes defined in the existing server contract without requiring any new or modified server-side field.
5. IF the redesign would require a change to any file under `server/` to function, THEN THE redesign SHALL treat this as a contract violation and SHALL NOT proceed with that change.

### Requirement 20: Steering File Update

**User Story:** As a developer, I want the HUD steering file updated to the new palette, so that future edits to `web/` follow the redesigned conventions.

#### Acceptance Criteria

1. THE Steering_File SHALL be updated in place, retaining its existing `inclusion` and `fileMatchPattern` front matter values unchanged.
2. THE Steering_File SHALL document the redesign palette as a set of named entries, each specifying a name and its corresponding color value, covering all ten of: background, panel, raised, border, silver text, muted text, orange, sage, soft red, and steel.
3. IF any one of the ten required palette entries is absent from the Steering_File, THEN THE Steering_File SHALL be considered non-conforming and the update SHALL be treated as incomplete.
4. THE Steering_File SHALL document the Semantic_Color meaning for each of the four roles, mapping primary/attention, verified, stop/abstain, and info/skill each to exactly one named palette entry defined in criterion 2.
5. THE Steering_File SHALL document the motion principles, including a transition duration range of 200 ms to 400 ms using ease-out timing, an explicit prohibition on each of neon glow, scanlines, glitch, and full-screen flash, and an explicit statement that the Reduced_Motion preference must be honored.
6. THE Steering_File SHALL retain, with wording semantically unchanged, each of the following existing rules: the no-franchise-naming rule, the deliberate approval-hold rule, the server-sourced-status rule, and the layout targets.
7. IF any one of the four rules listed in criterion 6 is absent from or altered in meaning within the updated Steering_File, THEN THE Steering_File SHALL be considered non-conforming and the update SHALL be treated as incomplete.
