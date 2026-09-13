/** Wire shape of GET /api/v1/analytics/month. */
export interface Summary {
  corridors: number;
  affectedCorridors: number;
  blockEvents: number;
  jobsScheduled: number;
  possessionHours: number;
  jobHours: number;
  hoursSavedByJointBlocks: number;
  jointBlocks: number;
  multiDeptBlocks: number;
  availabilityPct: number;
  availabilityPctUnbundled: number;
  availabilityPctAffected: number;
  availabilityPctAffectedUnbundled: number;
  corridorHoursAvailable: number;
  scheduledOnTime: number;
  scheduledLate: number;
  severityAScheduled: number;
  speedRestrictionsScheduled: number;
  rescheduledFromOverdue: number;
  systemPlanned: number;
  backlogTotal: number;
  backlogOpen: number;
  backlogOverdueOpen: number;
  backlogCompleted: number;
  avgPriority: number | null;
  avgDeferCount: number;
  maxDeferCount: number;
  blocksCancellingTrains: number;
  trainsCancelled: number;
}
export interface CorridorRow {
  corridorId: string;
  zone: string;
  stations: string;
  trainCount: number;
  blockEvents: number;
  jobs: number;
  possessionHours: number;
  jobHours: number;
  hoursSaved: number;
  jointBlocks: number;
  multiDeptBlocks: number;
  departments: string[];
  onTime: number;
  late: number;
  severityA: number;
  rescheduled: number;
  openRequests: number;
  overdueRequests: number;
  availabilityPct: number;
}
export interface ZoneRow {
  zone: string;
  corridors: number;
  affectedCorridors: number;
  blockEvents: number;
  jobs: number;
  possessionHours: number;
  jobHours: number;
  jointBlocks: number;
  openRequests: number;
  overdueRequests: number;
  rescheduled: number;
  availabilityPct: number;
  availabilityPctAffected: number;
}
export interface MonthAnalytics {
  period: string;
  start: string;
  end: string;
  days: number;
  zone: string | null;
  summary: Summary;
  statusCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  departments: Record<string, { jobs: number; hours: number; open: number; overdue: number; rescheduled: number }>;
  workTypes: { defectType: string; department: string; jobs: number; hours: number; open: number }[];
  daily: { day: string; jobs: number; hours: number; corridors: number; blockEvents: number }[];
  hourly: { hour: number; blockStarts: number; possessionMinutes: number; possessionHours: number }[];
  zones: ZoneRow[];
  corridors: CorridorRow[];
  priorityScores: number[];
  latenessDays: number[];
  closures: { defectId: string; corridorId: string; zone: string; department: string; defectType: string; blockStart: string; blockEnd: string; trainsCancelled: number }[];
}
