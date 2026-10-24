/**
 * ENGRAM Rover: part data, groups, copy and small pure helpers.
 * Everything here is framework-free so it can be unit tested.
 */

export type Vec3 = [number, number, number];

export interface PartSpec {
  name: string;
  assembled: Vec3;
  exploded: Vec3;
}

/** Relative paths (no leading slash) so the site works from any subfolder. */
export const MODEL_URL = "models/rover_web.glb";
export const PARTS_URL = "models/rover_parts.json";

export const BRAND_HEX = "#ff8a2a";
export const STAGE_HEX = "#141518";

export type GroupId = "base" | "body" | "arm" | "hand" | "sensor";

export interface PartGroup {
  id: GroupId;
  label: string;
  parts: string[];
}

export const GROUPS: PartGroup[] = [
  {
    id: "base",
    label: "Base",
    parts: [
      "01_Chassis_Frame",
      "02_Front_Left_Wheel",
      "03_Front_Right_Wheel",
      "04_Rear_Left_Wheel",
      "05_Rear_Right_Wheel",
    ],
  },
  { id: "body", label: "Body", parts: ["06_Rear_Equipment_Enclosure", "07_Top_Protective_Rails"] },
  {
    id: "arm",
    label: "Arm",
    parts: [
      "08_Arm_Base_Pedestal",
      "09_Shoulder_Joint",
      "10_Lower_Arm_Link",
      "11_Elbow_Joint",
      "12_Upper_Arm_Link",
      "13_Wrist_Joint",
    ],
  },
  {
    id: "hand",
    label: "Hand",
    parts: ["14_Gripper_Body", "15_Left_Gripper_Finger", "16_Right_Gripper_Finger"],
  },
  { id: "sensor", label: "Sensor", parts: ["17_Top_Sensor_Housing"] },
];

/** All parts in build order (Base, Body, Arm, Hand, Sensor). */
export const PART_ORDER: string[] = GROUPS.flatMap((g) => g.parts);

/** "02_Front_Left_Wheel" -> "Front Left Wheel" */
export function displayName(name: string): string {
  return name.replace(/^\d+_/, "").replace(/_/g, " ").trim();
}

export function groupIndexOf(name: string): number {
  return GROUPS.findIndex((g) => g.parts.includes(name));
}

export function groupOf(name: string): PartGroup | undefined {
  return GROUPS[groupIndexOf(name)];
}

/** Arm joints are numbered in order, pedestal first (1..6). 0 if not an arm part. */
export function armJointNumber(name: string): number {
  const arm = GROUPS.find((g) => g.id === "arm")!;
  return arm.parts.indexOf(name) + 1;
}

// ---------- Info card copy ----------
// "does" is the team's text. Parts of it marked TEAM in the brief are still unknown and are
// left out (see comments) until the team supplies them. "what" is a neutral one-liner
// derived from the part name only.

/** Brain is not a 3D part: it lives inside the rear enclosure. */
export const BRAIN_ID = "brain";
export const BRAIN_HOST_PART = "06_Rear_Equipment_Enclosure";

export type InfoGroupLabel = PartGroup["label"] | "Brain";

export interface PartInfo {
  title: string;
  group: InfoGroupLabel;
  what: string;
  does: string;
}

const PART_TEXT: Record<string, { what: string; does: string }> = {
  "01_Chassis_Frame": {
    what: "The main frame of the rover.",
    does: "The base everything mounts onto.",
  },
  "02_Front_Left_Wheel": { what: "Front left wheel.", does: "Drive wheel." }, // TEAM: motor type, steering
  "03_Front_Right_Wheel": { what: "Front right wheel.", does: "Drive wheel." }, // TEAM
  "04_Rear_Left_Wheel": { what: "Rear left wheel.", does: "Drive wheel." }, // TEAM
  "05_Rear_Right_Wheel": { what: "Rear right wheel.", does: "Drive wheel." }, // TEAM
  "06_Rear_Equipment_Enclosure": {
    what: "The box at the back of the body.",
    does: "Holds the electronics, including the Raspberry Pi 5.", // TEAM: confirm, battery, motor driver
  },
  "07_Top_Protective_Rails": {
    what: "The rail frame on top of the body.",
    does: "Protects the top of the body.",
  },
  "08_Arm_Base_Pedestal": {
    what: "The base of the arm.",
    does: "Mounts the arm to the body and lets it turn.",
  },
  "09_Shoulder_Joint": { what: "The shoulder joint of the arm.", does: "Arm joint." }, // TEAM: servo model
  "10_Lower_Arm_Link": {
    what: "The arm segment between shoulder and elbow.",
    does: "Rigid arm segment between two joints.",
  },
  "11_Elbow_Joint": { what: "The elbow joint of the arm.", does: "Arm joint." }, // TEAM: servo model
  "12_Upper_Arm_Link": {
    what: "The arm segment between elbow and wrist.",
    does: "Rigid arm segment between two joints.",
  },
  "13_Wrist_Joint": { what: "The wrist joint, just before the gripper.", does: "Arm joint." }, // TEAM: servo model
  "14_Gripper_Body": {
    what: "The body of the two finger gripper.",
    does: "Opens and closes the two fingers.",
  },
  "15_Left_Gripper_Finger": {
    what: "The left finger of the gripper.",
    does: "Grips the tagged objects the robot is asked to move.",
  },
  "16_Right_Gripper_Finger": {
    what: "The right finger of the gripper.",
    does: "Grips the tagged objects the robot is asked to move.",
  },
  "17_Top_Sensor_Housing": { what: "The housing at the top of the arm.", does: "" }, // TEAM: what this sensor is
};

/** Card order for Previous / Next: parts in number order, then Brain. */
export const INFO_ORDER: string[] = [...PART_ORDER, BRAIN_ID];

export function partInfo(id: string): PartInfo {
  if (id === BRAIN_ID) {
    return {
      title: "Raspberry Pi 5",
      group: "Brain",
      what: "The single board computer inside the rear enclosure.",
      // TEAM: what runs on the Pi, and how it connects (Wi Fi / USB / Ethernet)
      does: "The robot's onboard computer. It talks to ENGRAM.",
    };
  }
  const text = PART_TEXT[id] ?? { what: "", does: "" };
  return { title: displayName(id), group: groupOf(id)?.label ?? "Base", ...text };
}

export function partDescription(id: string): string {
  return partInfo(id).does;
}

/** The 3D part that lights up for a list / card entry (Brain lights its enclosure). */
export function highlightPartFor(id: string): string {
  return id === BRAIN_ID ? BRAIN_HOST_PART : id;
}

export function stepInfo(id: string, dir: 1 | -1): string {
  const i = INFO_ORDER.indexOf(id);
  const n = INFO_ORDER.length;
  return INFO_ORDER[(((i + dir) % n) + n) % n] ?? INFO_ORDER[0]!;
}

export interface BuildStep {
  id: string;
  title: string;
  caption: string;
}

export const BUILD_STEPS: BuildStep[] = [
  { id: "base", title: "Base", caption: "We started with the chassis and four wheels." },
  {
    id: "body",
    title: "Body",
    caption: "The electronics went into the rear enclosure, with rails on top.",
  },
  { id: "arm", title: "Arm", caption: "We mounted a six joint arm on a pedestal." },
  { id: "hand", title: "Hand", caption: "A two finger gripper for picking up objects." },
  { id: "sensor", title: "Sensor", caption: "A sensor housing sits at the tip of the arm." }, // TEAM
  {
    id: "brain",
    title: "Brain",
    caption: "An offline computer runs ENGRAM and talks to the robot.", // TEAM: computer + link
  },
];

export const BUILD_STEP_MS = 4000;

export type PartStepState = "placed" | "adding" | "ghost";

/**
 * In the build player, step i (0-based) adds group i. Earlier groups are placed,
 * later groups are ghosted. The final "Brain" step shows every part placed.
 */
export function partStepState(groupIndex: number, stepIndex: number): PartStepState {
  if (stepIndex >= GROUPS.length) return "placed";
  if (groupIndex < stepIndex) return "placed";
  if (groupIndex === stepIndex) return "adding";
  return "ghost";
}

export interface LoopNode {
  title: string;
  text: string;
}

export const LOOP_NODES: LoopNode[] = [
  { title: "Ask", text: "You speak or type a task on the iPad." },
  {
    title: "Remember",
    text: "ENGRAM searches its memory: where objects were last seen, rules it was taught, and documents it read.",
  },
  { title: "Plan", text: "It makes a step by step plan, or reuses a skill it already learned." },
  { title: "Check", text: "Every plan is checked against the rules before anything moves." },
  {
    title: "Approve",
    text: "A person approves the plan on the iPad. Nothing runs without approval.",
  },
  {
    title: "Act and learn",
    text: "The robot runs the plan and writes what happened back into memory.",
  },
];

/** Example data only, not live. */
export const PLANNER_CALLS_EXAMPLE = [3, 3, 2, 0, 0];

// ---------- math helpers ----------

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Slight overshoot ease. */
export function easeOutBack(x: number, overshoot = 1.1): number {
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2);
}

export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
