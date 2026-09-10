export type Department = "ENGG" | "TRD" | "S&T" | "MULTI";

export type Severity = "A" | "B" | "C";

export type MaintenanceStatus = "open" | "assessed" | "candidate_window_identified" | "scheduled" | "cleared" | "deferred";

export type RequestStatus = "open" | "assessed" | "candidate_window_identified" | "proposed" | "scheduled" | "approved" | "rejected" | "deferred";

export type PlanStatus = "draft" | "proposed" | "approved" | "rejected" | "modified";

export type WindowStatus = "candidate" | "proposed" | "approved";

export interface Station {
  id: string;
  name: string;
  code: string;
}

export interface Junction {
  id: string;
  stationId: string;
  connectingCorridors: string[];
}

export interface Crossover {
  id: string;
  location: string; // e.g., "Km 124.5"
  corridorId: string;
}

export interface Corridor {
  id: string;
  name: string;
  stations: string[]; // ordered list of station IDs
  lengthKm: number;
}

export interface NetworkTopology {
  stations: Station[];
  corridors: Corridor[];
  junctions: Junction[];
  crossovers: Crossover[];
}

export interface MaintenanceJob {
  id: string;
  sourceSystem: "TMS" | "SMMS" | "TDMS";
  department: Department;
  assetId: string;
  corridorId: string;
  defectType: string;
  severity: Severity;
  detectedDate: string;
  dueDate: string;
  daysOverdue: number;
  speedRestrictionActive: boolean;
  estimatedBlockHours: number;
  priorityScore?: number; // Demo Priority Engine score
  priorityExplanation?: { factor: string; score: number }[];
  status: MaintenanceStatus;
  // Optional scheduling preference (populated from MaintenanceRequest intake)
  preferredDate?: string;
  preferredStart?: string; // "HH:mm"
  preferredEnd?: string;   // "HH:mm" — calculated, not user-entered
  notes?: string;
  fromRequest?: boolean; // true = submitted via New Request form
}

export interface CandidateWindow {
  id: string;
  corridorId: string;
  start: string; // ISO datetime
  end: string;   // ISO datetime
  durationHours: number;
  source: string; // "Derived from timetable gap", etc.
  status: WindowStatus;
}

export interface Train {
  id: string;
  type: "Passenger" | "Freight" | "Express";
  route: string;
  priorityClass: string;
}

export interface ScheduleEvent {
  id: string;
  trainId: string;
  corridorId: string;
  start: string; // ISO datetime entry to corridor
  end: string;   // ISO datetime exit from corridor
  eventType: "transit" | "halt";
}

export interface BlockAssignment {
  id: string;
  planId: string;
  corridorId: string;
  windowId: string;
  jobs: string[]; // MaintenanceJob IDs
  departments: Department[];
  start: string;
  end: string;
  durationHours: number;
  status: PlanStatus;
  jointBlockGroupId?: string; // If grouped with other assignments
  overrideFlag?: boolean;
  overrideReason?: string;
}

export interface PlanMetrics {
  totalBlockGroups: number;
  totalBlockHours: number;
  criticalJobsScheduled: number;
  assetDowntimeHours: number;
  corridorCapacityUtilization: number;
}

export interface Plan {
  id: string;
  name: string;
  createdAt: string;
  horizon: "weekly" | "monthly";
  status: PlanStatus;
  assignments: BlockAssignment[];
  metrics: PlanMetrics;
}

// ---- Departmental Maintenance Request (intake form output) ----
export interface MaintenanceRequest {
  id: string;
  department: Department;
  sourceSystem: "TMS" | "SMMS" | "TDMS";
  corridorId: string;
  assetId: string;
  maintenanceType: string;
  severity: Severity;
  detectedDate: string;
  dueDate: string;
  preferredDate: string;
  preferredStart: string; // "HH:mm"
  preferredEnd: string;   // calculated "HH:mm"
  estimatedDurationHours: number;
  speedRestrictionActive: boolean;
  notes: string;
  status: RequestStatus;
  submittedAt: string; // ISO
}
