import type { DefectRequest } from "../types/api";

/**
 * One place that turns a request's stored workflow status plus the clock
 * (overdue / upcoming / in progress / completed) into what a person should
 * read on screen. Every table, card and filter uses this so they agree.
 */
export type DisplayStatus =
  | "requested"
  | "overdue"
  | "awaiting_response"
  | "awaiting_controller"
  | "upcoming"
  | "in_progress"
  | "completed"
  | "cleared";

export const DISPLAY_LABEL: Record<DisplayStatus, string> = {
  requested: "Requested",
  overdue: "Overdue — not yet placed",
  awaiting_response: "Reschedule offered — respond",
  awaiting_controller: "Awaiting controller",
  upcoming: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cleared: "Cleared",
};

export const DISPLAY_COLOR: Record<DisplayStatus, string> = {
  requested: "text-amber-400",
  overdue: "text-red-400",
  awaiting_response: "text-blue-400",
  awaiting_controller: "text-blue-400",
  upcoming: "text-emerald-400",
  in_progress: "text-emerald-400",
  completed: "text-ops-muted",
  cleared: "text-ops-muted",
};

export const DISPLAY_ORDER: DisplayStatus[] = ["in_progress", "upcoming", "awaiting_response", "awaiting_controller", "overdue", "requested", "completed", "cleared"];

export function displayStatus(r: DefectRequest): DisplayStatus {
  if (r.workflowStatus === "cleared") return "cleared";
  if (r.workflowStatus === "completed" || r.executionState === "completed") return "completed";
  if (r.workflowStatus === "scheduled") return r.executionState === "in_progress" ? "in_progress" : "upcoming";
  if (r.workflowStatus === "awaiting_dept_response") return "awaiting_response";
  if (r.workflowStatus === "awaiting_controller") return "awaiting_controller";
  return r.isOverdue ? "overdue" : "requested";
}

export const EVENT_LABEL: Record<string, string> = {
  submitted: "Submitted",
  ingested: "Ingested from backlog upload",
  scheduled: "Scheduled",
  plan_scheduled: "Placed by approved plan",
  auto_rescheduled: "Rescheduled (was overdue)",
  reschedule_offered: "Alternate window offered",
  reschedule_accepted: "Offer accepted by department",
  reschedule_rejected: "Offer rejected by department",
  preemption_requested: "Priority bump requested",
  modification_rejected: "Rejected by controller",
  bumped: "Bumped by higher priority",
  released: "Released by re-generated plan",
  lapsed: "Lapsed (window passed)",
  completed: "Completed",
  cleared: "Cleared",
};

/** An overdue request the clock placed into the upcoming week, still holding that block. */
export function isRescheduled(r: { rescheduledAt: string | null; workflowStatus: string }): boolean {
  return Boolean(r.rescheduledAt) && r.workflowStatus === "scheduled";
}

/**
 * What sharing a possession means for this request. A "joint block" is the
 * multi-department case — the thing coordinated block planning exists for.
 * Same-department jobs queued back to back in one window are a shared
 * possession, worth the same downtime saving, but not a joint block.
 */
export function possessionLabel(r: DefectRequest): { text: string; joint: boolean } | null {
  if (!r.jointBlockGroupId || !r.groupSize || r.groupSize < 2) return null;
  const others = (r.groupDepartments ?? []).filter((d) => d !== r.department);
  if (others.length > 0) return { text: `JOINT BLOCK with ${others.join(", ")}`, joint: true };
  return { text: `SHARED POSSESSION · ${r.groupSize} ${r.department} jobs back to back`, joint: false };
}

/** The calendar day a request's block lives on (for a one-day Gantt). */
export function blockDay(r: DefectRequest): string {
  const iso = r.allocatedStart ?? r.requestedWindowStart ?? `${r.dueDate}T00:00:00`;
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
