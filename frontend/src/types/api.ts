export type Department = "ENGG" | "SIGNAL" | "TRD";
export type Role = Department | "CONTROLLER";

export interface LoginResponse {
  token: string;
  username: string;
  role: Role;
  displayName: string;
}

export interface Corridor {
  corridorId: string;
  stationACode: string;
  stationBCode: string;
  direction: "up" | "down";
  lineName: string;
  zone: string | null;
  lengthKm: number | null;
  trainCount: number;
}

export interface PriorityFactor {
  factor: string;
  score: number;
}

export type WorkflowStatus = "pending" | "scheduled" | "awaiting_dept_response" | "awaiting_controller" | "completed" | "cleared";
export type ExecutionState = "upcoming" | "in_progress" | "completed";

export interface DefectRequest {
  defectId: string;
  sourceSystem: string;
  assetId: string | null;
  corridorId: string | null;
  zone: string | null;
  defectType: string;
  severityCode: "A" | "B" | "C";
  department: Department;
  detectedDate: string;
  dueDate: string;
  speedRestrictionKmph: number | null;
  estimatedBlockHours: number;
  requestedWindowStart: string | null;
  requestedWindowEnd: string | null;
  requestedBy: string | null;
  deferCount: number;
  workflowStatus: WorkflowStatus;
  priorityScore: number | null;
  priorityExplanation: PriorityFactor[] | null;
  updatedAt: string | null;
  allocatedStart: string | null;
  allocatedEnd: string | null;
  planId: string | null;
  planPeriodLabel: string | null;
  jointBlockGroupId: string | null;
  groupDepartments: Department[] | null;
  groupSize: number | null;
  isOverdue: boolean;
  executionState: ExecutionState | null;
  /** Set when the clock sweep placed this overdue request into the upcoming week. */
  rescheduledAt: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
  lastEventDetails: string | null;
  lastEventActor: string | null;
}

export interface DefectEvent {
  eventId: string;
  defectId: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  actor: string | null;
  details: string | null;
  occurredAt: string;
  department: Department;
  corridorId: string | null;
  zone: string | null;
  defectType: string;
  severityCode: "A" | "B" | "C";
}

export interface ModelVersion {
  versionId: string;
  trainedAt: string;
  artifactPath: string;
  metrics: Record<string, unknown> | null;
  promoted: boolean;
}

export interface BulkPlanResult {
  zone: string;
  planId: string | null;
  periodLabel: string | null;
  objectiveValue: number;
  solverStatus: string | null;
  assignments: number;
  zeroScorePending: number;
  error: string | null;
}

export interface BlockPlan {
  planId: string;
  horizonType: "weekly" | "monthly";
  periodLabel: string;
  horizonStart: string;
  horizonEnd: string;
  zone: string | null;
  generatedAt: string;
  status: "pending_approval" | "approved" | "superseded" | string;
  solverStatus: string | null;
  objectiveValue: number | null;
  solveSeconds: number | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface BlockAssignment {
  assignmentId: string;
  planId: string;
  windowId: string | null;
  corridorId: string | null;
  defectId: string | null;
  department: Department;
  allocatedStart: string;
  allocatedEnd: string;
  jointBlockGroupId: string | null;
}

export type ModificationType = "reschedule" | "preemption";
export type ModificationStatus = "pending_dept" | "pending_controller" | "approved" | "rejected" | "lapsed";

export interface ModificationRequest {
  requestId: string;
  requestType: ModificationType;
  defectId: string | null;
  requestingDepartment: Department;
  targetPlanId: string | null;
  affectedDefectId: string | null;
  affectedDepartment: Department | null;
  proposedCorridorId: string | null;
  proposedWindowStart: string | null;
  proposedWindowEnd: string | null;
  description: string;
  status: ModificationStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  defectType: string | null;
  severityCode: string | null;
  estimatedBlockHours: number | null;
  originalWindowStart: string | null;
  originalWindowEnd: string | null;
}

export interface Notification {
  notificationId: string;
  recipientRole: Role;
  message: string;
  relatedRequestId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface CompatibilityEntry {
  deptA: Department;
  deptB: Department;
  compatible: boolean;
  notes: string | null;
}

export interface CompatibilityOverrideEntry {
  windowId: string;
  deptA: Department;
  deptB: Department;
  compatible: boolean;
  notes: string | null;
  isOverride: boolean;
}

export interface CorridorBlockWindow {
  windowId: string;
  corridorId: string;
  windowStart: string;
  windowEnd: string;
  maxConcurrentDepts: number;
}

export interface ScheduleAssignment {
  assignmentId: string;
  defectId: string | null;
  department: Department;
  allocatedStart: string;
  allocatedEnd: string;
  jointBlockGroupId: string | null;
  defectType: string | null;
  severityCode: string | null;
  requestedBy: string | null;
  planStatus: string | null;
  planPeriodLabel: string | null;
  assetId: string | null;
  sourceSystem: string | null;
  estimatedBlockHours: number | null;
  dueDate: string | null;
  priorityScore: number | null;
  speedRestrictionKmph: number | null;
  rescheduledAt: string | null;
}

export interface ScheduleTraversal {
  trainNumber: string;
  trainName: string | null;
  direction: string;
  departMin: number;
  arriveMin: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface SchedulePendingRequest {
  defectId: string;
  department: Department;
  defectType: string;
  severityCode: "A" | "B" | "C";
  estimatedBlockHours: number;
  requestedWindowStart: string | null;
  requestedWindowEnd: string | null;
  priorityScore: number | null;
  workflowStatus: WorkflowStatus;
}

export interface GoodsForecastBand {
  forecastId: string;
  corridorId: string;
  forecastDate: string;
  bandStart: string;
  bandEnd: string;
  trainCount: number;
  source: string;
}

export interface CorridorSchedule {
  corridorId: string;
  windows: CorridorBlockWindow[];
  assignments: ScheduleAssignment[];
  pendingRequests: SchedulePendingRequest[];
  goodsForecasts: GoodsForecastBand[];
  traversals: ScheduleTraversal[];
}

export interface PlanDepartmentKpi {
  jobs: number;
  hours: number;
  open: number;
}

export interface PlanKpis {
  planId: string;
  zone: string | null;
  horizonType: "weekly" | "monthly" | string;
  periodLabel: string;
  horizonStart: string;
  horizonEnd: string;
  days: number;
  corridorsInZone: number;
  weeklyPlansIncluded: number;
  availabilityPct: number;
  availabilityPctUnbundled: number;
  affectedCorridors: number;
  availabilityPctAffected: number;
  availabilityPctAffectedUnbundled: number;
  corridorHoursAvailable: number;
  possessionHours: number;
  jobHours: number;
  hoursSavedByJointBlocks: number;
  blockEvents: number;
  jointBlocks: number;
  multiDeptBlocks: number;
  jobsScheduled: number;
  openBacklog: number;
  severityAScheduled: number;
  severityATotal: number;
  speedRestrictionsScheduled: number;
  speedRestrictionsTotal: number;
  overdueScheduled: number;
  overdueTotal: number;
  scheduledOnTime: number;
  scheduledLate: number;
  passengerTrainsAffected: number;
  goodsPathsForecast: number;
  goodsPathsConflicting: number;
  departments: Record<string, PlanDepartmentKpi>;
}

export interface PlanKpiPlanRef {
  planId: string;
  zone: string | null;
  status: string;
}

/** One period consolidated across zones (GET /plans/kpis). */
export interface PeriodKpis extends Omit<PlanKpis, "planId"> {
  planId: string | null;
  zonesIncluded: string[];
  zonesMissing: string[];
  plans: PlanKpiPlanRef[];
  statusCounts: Record<string, number>;
}

export interface ResetJobStatus {
  jobId: string;
  status: "running" | "done" | "failed";
  stage: string | null;
  progress: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  log: string[];
  stats: Record<string, unknown>;
}

export interface Asset {
  assetId: string;
  corridorId: string;
  assetType: string;
  department: Department;
  kmMarker: number | null;
}

export interface ZoneSummary {
  zone: string | null;
  pendingRequests: number;
  corridors: number;
}

export interface PlanHistoryEntry {
  historyId: string;
  planId: string;
  horizonType: string;
  periodLabel: string;
  snapshotType: "proposed" | "final" | "rejected";
  snapshotAt: string;
  payload: unknown;
}

