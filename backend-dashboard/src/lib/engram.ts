/**
 * Client for the ENGRAM Cortex HTTP API (engram/api.py).
 *
 * The API base URL is a setting, saved in localStorage, so the iPad can point at
 * the Mac's IP on the local network. Everything is JSON except the camera stream.
 */

const BASE_KEY = "engram_api_base";
const BASE_EVENT = "engram-api-base-changed";

export function defaultBase(): string {
  if (typeof window === "undefined") return "http://localhost:8000";
  const host = window.location.hostname || "localhost";
  const proto = window.location.protocol === "https:" ? "https:" : "http:";
  return `${proto}//${host}:8000`;
}

export function getApiBase(): string {
  if (typeof window === "undefined") return "http://localhost:8000";
  try {
    return window.localStorage.getItem(BASE_KEY) || defaultBase();
  } catch {
    return defaultBase();
  }
}

export function setApiBase(value: string): void {
  if (typeof window === "undefined") return;
  const clean = value.trim().replace(/\/+$/, "");
  try {
    window.localStorage.setItem(BASE_KEY, clean);
  } catch {
    /* private mode: keep going, just not remembered */
  }
  window.dispatchEvent(new CustomEvent(BASE_EVENT, { detail: clean }));
}

export const API_BASE_EVENT = BASE_EVENT;

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type ApiInit = Omit<RequestInit, "body"> & { json?: unknown };

export async function api<T>(base: string, path: string, init: ApiInit = {}): Promise<T> {
  const { json, headers: initHeaders, ...rest } = init;
  const headers: Record<string, string> = { ...(initHeaders as Record<string, string>) };
  let body: BodyInit | null = null;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  let res: Response;
  try {
    res = await fetch(base + path, { ...rest, headers, body });
  } catch (e) {
    throw new ApiError(`Can't reach the server at ${base}. Is it running?`, 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || res.statusText;
    throw new ApiError(String(detail), res.status);
  }
  return data as T;
}

/* ---- shapes returned by the API ---- */

export interface Health {
  ok: boolean;
  robot?: string | null;
}

export interface RobotState {
  adapter: string;
  at_zone?: string;
  holding?: string | null;
  gripper_open?: boolean;
  stopped: boolean;
  objects?: Record<string, string>;
  connected?: boolean;
  error?: string;
}

export interface ObjectRow {
  object_id: string;
  name: string;
  tag_id: number | null;
  graspable: boolean;
  last_zone: string | null;
  last_seen_at: number | null;
  freshness: number;
  statement: string;
}

export interface Fact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  source_id: string | null;
  chunk_id: string | null;
}

export interface Evidence {
  chunk_id: string;
  source_id: string;
  title: string;
  section: string | null;
  span?: [number, number];
  text: string;
}

export interface MemoryBundle {
  goal: string;
  facts: Fact[];
  objects: Array<Record<string, unknown>>;
  applicable_skills: string[];
  constraints: string[];
  evidence: Evidence[];
  missing: string[];
}

export interface PlanStep {
  op: string;
  args?: Record<string, unknown>;
}

export interface Check {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface Proposal {
  kind?: string;
  operation_id: string;
  status: "proposed" | "rejected" | "refused";
  reason?: string;
  plan?: { goal: string; steps: PlanStep[]; evidence?: unknown[]; rules_used?: unknown[]; skill_id?: string };
  digest?: string;
  check?: Check;
  memory?: MemoryBundle;
  source?: string;
  planner_calls?: number;
  planning_ms?: number;
}

export interface Taught {
  kind: "taught";
  source_id: string;
  rules: Fact[];
}

export interface Scheduled {
  kind: "scheduled";
  task_id: string;
  created: boolean;
  trigger: string;
  request: string;
}

export type CommandResult = (Proposal & { kind: "proposal" }) | Taught | Scheduled;

export interface StepResult {
  op: string;
  args?: Record<string, unknown>;
  status: string;
  detail?: string;
}

export interface RunResult {
  operation_id: string;
  outcome: "success" | "failed" | "aborted" | "rejected";
  failure?: string | null;
  steps?: StepResult[];
  check?: Check;
}

export interface Skill {
  id: string;
  name: string;
  version: number;
  status: "CANDIDATE" | "TESTED" | "APPROVED" | "REVOKED";
  digest: string;
}

export interface EventRow {
  seq: number;
  operation_id: string;
  episode_id: string | null;
  op: string;
  args_json: string;
  status: string;
  detail: string | null;
  at: number;
}

export interface MetricRun {
  id: string;
  request: string;
  outcome: string;
  planner_calls: number;
  planning_ms: number | null;
  skill_id: string | null;
}

export interface Metrics {
  runs: MetricRun[];
  skills: Record<string, number>;
  model_unchanged: boolean;
  journal_rows: number;
}

export interface ProspectiveTask {
  id: string;
  trigger: string;
  goal: string;
  request: string;
  status: "waiting" | "fired" | "done" | "cancelled";
  created_at: number;
  fired_at: number | null;
  proposal_id: string | null;
}

export interface CameraStatus {
  online: boolean;
  has_frame: boolean;
  age_s: number | null;
  bytes: number;
  seq: number;
}

/* ---- display helpers shared across panels ---- */

const OP_WORDS: Record<string, string> = {
  locate_tag: "Find",
  approach_tag: "Approach",
  pick_tagged_object: "Pick up",
  place_at_zone: "Place at",
  go_to_zone: "Go to",
  drive_bounded: "Drive",
  turn_bounded: "Turn",
  gripper_open: "Open gripper",
  gripper_close: "Close gripper",
  observe: "Look around",
  speak: "Say",
  ask: "Ask",
  remember: "Remember",
  schedule: "Schedule",
  stop: "Stop",
};

export function zoneLabel(zone: string | null | undefined): string {
  if (!zone) return "—";
  return zone
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function stepText(step: PlanStep, objects?: ObjectRow[]): string {
  const word = OP_WORDS[step.op] ?? step.op;
  const args = step.args ?? {};
  if ("object_id" in args) {
    const id = String(args["object_id"]);
    const name = objects?.find((o) => o.object_id === id)?.name ?? id;
    return `${word} ${name}`;
  }
  if ("zone" in args) return `${word} ${zoneLabel(String(args["zone"]))}`;
  if ("text" in args) return `${word}: "${String(args["text"])}"`;
  if ("distance_m" in args) return `${word} ${args["distance_m"]} m`;
  if ("degrees" in args) return `${word} ${args["degrees"]}°`;
  if ("question" in args) return `${word}: "${String(args["question"])}"`;
  return word;
}
