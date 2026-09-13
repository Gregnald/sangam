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
  no_fit: "No slot found (see details)",
  block_accepted: "Block accepted by controller",
  block_rejected: "Block rejected by controller",
  block_removed: "Block removed by controller",
  replace_requested: "Controller asked for a different slot",
  force_bump: "Controller forced placement",
  traffic_suspended: "Declared unsafe for trains",
  traffic_restored: "Trains may run again",
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

/** Short form of a request id for display; the full UUID goes in a title/tooltip. */
export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

/**
 * What an unplaced request is waiting for, in one sentence — or null when
 * it isn't waiting (scheduled / done). The one hard case is a job longer
 * than any timetable gap on its corridor: nothing will ever place it unless
 * the section can be closed to trains for it.
 */
export function waitingFor(r: DefectRequest): { text: string; impossible: boolean } | null {
  if (r.workflowStatus === "scheduled" || r.workflowStatus === "completed" || r.workflowStatus === "cleared") return null;
  if (r.workflowStatus === "awaiting_dept_response") return { text: "An alternate window has been offered — waiting for the department to accept or reject it.", impossible: false };
  if (r.workflowStatus === "awaiting_controller") return { text: "Waiting for the controller to decide the bump / reschedule request.", impossible: false };
  if (r.trafficSuspended) return { text: "Flagged unsafe for trains — will be placed over the timetable at the next sweep.", impossible: false };
  if (r.maxGapHours != null && r.estimatedBlockHours > r.maxGapHours + 1e-6) {
    return {
      text: `No timetable gap on this corridor is long enough: needs ${r.estimatedBlockHours.toFixed(2)} h, longest gap ahead is ${r.maxGapHours.toFixed(2)} h. Nothing will place it until the block can run over the timetable (cancel trains), the job is split, or the timetable changes.`,
      impossible: true,
    };
  }
  if (r.priorityScore == null) return { text: "Not scored yet — placed once the priority model has run.", impossible: false };
  if (r.isOverdue) return { text: "Overdue: the daily sweep retries every week ahead each morning; it fits a gap but every fitting slot so far is taken.", impossible: false };
  return { text: "Waiting for a slot: the next plan solve, the daily sweep (due within 14 days), or an offer.", impossible: false };
}

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
