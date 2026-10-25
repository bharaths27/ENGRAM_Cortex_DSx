import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import {
  api,
  API_BASE_EVENT,
  getApiBase,
  setApiBase as persistApiBase,
  type CameraStatus,
  type CommandResult,
  type EventRow,
  type Fact,
  type Health,
  type Metrics,
  type ObjectRow,
  type Proposal,
  type ProspectiveTask,
  type RobotState,
  type RunResult,
  type Skill,
} from "@/lib/engram";

/** The current API base URL, kept in sync with localStorage and other tabs/panels. */
export function useApiBase() {
  const [base, setBase] = useState(getApiBase());
  useEffect(() => {
    const onChange = () => setBase(getApiBase());
    window.addEventListener(API_BASE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(API_BASE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const update = useCallback((value: string) => persistApiBase(value), []);
  return [base, update] as const;
}

function useBase() {
  const [base] = useApiBase();
  return base;
}

export function useHealth() {
  const base = useBase();
  return useQuery({
    queryKey: ["health", base],
    queryFn: () => api<Health>(base, "/health"),
    refetchInterval: 4000,
    retry: false,
  });
}

export function useRobotState() {
  const base = useBase();
  return useQuery({
    queryKey: ["robot-state", base],
    queryFn: () => api<RobotState>(base, "/robot/state"),
    refetchInterval: 1500,
    retry: false,
  });
}

export function useObjects() {
  const base = useBase();
  return useQuery({
    queryKey: ["objects", base],
    queryFn: () => api<ObjectRow[]>(base, "/memory/objects"),
    refetchInterval: 2000,
    retry: false,
  });
}

export function useFacts() {
  const base = useBase();
  return useQuery({
    queryKey: ["facts", base],
    queryFn: () => api<Fact[]>(base, "/memory/facts"),
    refetchInterval: 5000,
    retry: false,
  });
}

export function useSkills() {
  const base = useBase();
  return useQuery({
    queryKey: ["skills", base],
    queryFn: () => api<Skill[]>(base, "/skills"),
    refetchInterval: 4000,
    retry: false,
  });
}

export function useEvents(limit = 30) {
  const base = useBase();
  return useQuery({
    queryKey: ["events", base, limit],
    queryFn: () => api<EventRow[]>(base, `/events?limit=${limit}`),
    refetchInterval: 2000,
    retry: false,
  });
}

export function useMetrics() {
  const base = useBase();
  return useQuery({
    queryKey: ["metrics", base],
    queryFn: () => api<Metrics>(base, "/metrics"),
    refetchInterval: 4000,
    retry: false,
  });
}

export function useProspective() {
  const base = useBase();
  return useQuery({
    queryKey: ["prospective", base],
    queryFn: () => api<ProspectiveTask[]>(base, "/prospective"),
    refetchInterval: 5000,
    retry: false,
  });
}

export function useCameraStatus() {
  const base = useBase();
  return useQuery({
    queryKey: ["camera-status", base],
    queryFn: () => api<CameraStatus>(base, "/camera/status"),
    refetchInterval: 2000,
    retry: false,
  });
}

/* ---- mutations ---- */

export function useSendCommand() {
  const base = useBase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { text: string; who?: string }) =>
      api<CommandResult>(base, "/commands", { method: "POST", json: { text: vars.text, who: vars.who ?? "ipad" } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["facts", base] });
      qc.invalidateQueries({ queryKey: ["prospective", base] });
    },
  });
}

export function useTeach() {
  const base = useBase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { title: string; text: string }) =>
      api<{ source_id: string; rules: Fact[] }>(base, "/memory/sources", { method: "POST", json: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["facts", base] }),
  });
}

export function useProposeRest() {
  const base = useBase();
  return useMutation({
    mutationFn: (vars: { zone: string }) => api<Proposal>(base, "/plan/rest", { method: "POST", json: vars }),
  });
}

export function useApprove() {
  const base = useBase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { operationId: string; digest: string; approvedBy?: string }) =>
      api<RunResult>(base, `/operations/${vars.operationId}/approve`, {
        method: "POST",
        json: { digest: vars.digest, approved_by: vars.approvedBy ?? "ipad" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events", base] });
      qc.invalidateQueries({ queryKey: ["metrics", base] });
      qc.invalidateQueries({ queryKey: ["objects", base] });
      qc.invalidateQueries({ queryKey: ["robot-state", base] });
    },
  });
}

export function useStop() {
  const base = useBase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<RobotState>(base, "/stop", { method: "POST", json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["robot-state", base] }),
  });
}

export function useClearStop() {
  const base = useBase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<RobotState>(base, "/robot/clear_stop", { method: "POST", json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["robot-state", base] }),
  });
}

export function useSkillAction() {
  const base = useBase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; action: "test" | "approve" | "revoke"; digest?: string }) => {
      const json = vars.action === "approve" ? { digest: vars.digest, approved_by: "ipad" } : {};
      return api<Skill>(base, `/skills/${vars.id}/${vars.action}`, { method: "POST", json });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills", base] });
      qc.invalidateQueries({ queryKey: ["metrics", base] });
    },
  });
}

export function useDream() {
  const base = useBase();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ candidates: string[] }>(base, "/dream/compile", { method: "POST", json: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills", base] }),
  });
}
