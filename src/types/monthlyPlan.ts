// ──────────────────────────────────────────────
// Monthly Maintenance Target Plan — Domain Types
// ──────────────────────────────────────────────
// IMPORTANT: The monthly plan is a STRATEGIC PLANNING LAYER.
// It is NOT a confirmed block schedule.
// Exact block timings are determined later in the rolling 2-week planning process.

export type MonthlySeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type MonthlyDept = 'ENGG' | 'TRD' | 'S&T';
export type TargetWeek = 1 | 2 | 3 | 4;
export type MonthlyClassification = 'TARGET' | 'PREPARE' | 'DEFER' | 'REVIEW';

export type MonthlyLifecycle =
  | 'BACKLOG'
  | 'PRIORITIZED'
  | 'MONTHLY_TARGET'
  | 'PREPARATION'
  | 'TWO_WEEK_PLANNING'
  | 'OPTIMIZED_CANDIDATE'
  | 'CONTROLLER_APPROVAL'
  | 'BDMS'
  | 'EXECUTED'
  | 'CLOSED';

export interface PriorityFactor {
  factor: string;
  points: number;
  reason: string;
}

export interface ControllerAction {
  timestamp: string;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
}

export interface MonthlyJob {
  id: string;
  department: MonthlyDept;
  sourceSystem: 'TMS' | 'TDMS' | 'SMMS';
  assetId: string;
  assetType: string;
  corridorId: string;
  section: string;
  defectType: string;
  defectDescription: string;
  severity: MonthlySeverity;
  safetyCriticality: MonthlySeverity;
  assetCriticality: MonthlySeverity;
  estimatedDurationHours: number;
  requiredResources: string[];
  requiredTeam: string;
  createdDate: string;
  dueDate: string;
  overdueDays: number;
  previousPostponements: number;
  lifecycle: MonthlyLifecycle;

  // Computed by planning engine
  priorityScore: number;
  priorityBreakdown: PriorityFactor[];
  classification: MonthlyClassification;
  targetWeek: TargetWeek | null;
  coordinationGroupId?: string; // same corridor grouping

  // Controller overrides (mutable in UI)
  controllerClassification?: MonthlyClassification;
  controllerTargetWeek?: TargetWeek | null;
  controllerNote?: string;
  actionLog: ControllerAction[];
}

export interface CoordinationGroup {
  id: string;
  corridorId: string;
  jobs: string[]; // MonthlyJob ids
  departments: MonthlyDept[];
  totalEstimatedHours: number;
  benefit: string;
}

export interface DeptCapacity {
  department: MonthlyDept;
  estimatedWorkloadHours: number;
  estimatedCapacityHours: number;
  utilizationPct: number;
  overloaded: boolean;
}

export interface MonthlyAlert {
  id: string;
  type: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
}

export interface MonthlyPlanSummary {
  month: string; // e.g. 'September 2026'
  totalBacklog: number;
  criticalJobs: number;
  overdueJobs: number;
  targetedThisMonth: number;
  estimatedWorkloadHours: number;
  estimatedCapacityHours: number;
  utilizationPct: number;
  coordinationOpportunities: number;
  deptCapacities: DeptCapacity[];
  alerts: MonthlyAlert[];
  coordinationGroups: CoordinationGroup[];
}
