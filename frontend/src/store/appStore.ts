import { create } from "zustand";
import { api, qs } from "../lib/api";
import type {
  BlockAssignment,
  BlockPlan,
  BulkPlanResult,
  DefectRequest,
  ModificationRequest,
  Notification,
  ResetJobStatus,
  ZoneSummary,
} from "../types/api";

interface AppState {
  zones: ZoneSummary[];
  selectedZone: string | null;
  requests: DefectRequest[];
  notifications: Notification[];
  modifications: ModificationRequest[];
  plans: BlockPlan[];
  activeAssignments: BlockAssignment[];
  isLoading: boolean;
  /** Bumped after a system reset so tab-local state remounts. */
  resetEpoch: number;
  /** Bumped when a plan's contents change in place (a block accepted/rejected from the Gantt) so KPI panels refetch. */
  planRevision: number;
  bumpPlanRevision: () => void;

  fetchZones: () => Promise<void>;
  setSelectedZone: (zone: string | null) => void;
  fetchRequests: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  fetchModifications: () => Promise<void>;
  fetchPlans: () => Promise<void>;
  fetchActiveWeeklyAssignments: () => Promise<void>;
  refetchAll: () => Promise<void>;
  startReset: (confirm: string) => Promise<{ jobId: string }>;
  getResetStatus: (jobId: string) => Promise<ResetJobStatus>;

  submitRequest: (body: {
    corridorId: string;
    assetId: string;
    defectType: string;
    severityCode: "A" | "B" | "C";
    estimatedBlockHours: number;
    dueDate: string;
    requestedWindowStart?: string;
    requestedWindowEnd?: string;
    speedRestrictionKmph?: number;
  }) => Promise<{ defectId: string; outcome: string }>;
  respondToReschedule: (requestId: string, accept: boolean) => Promise<void>;
  decideModification: (requestId: string, approve: boolean, reason?: string) => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  clearRequest: (defectId: string) => Promise<void>;

  generateMonthlyPlan: (zone: string, monthsAhead?: 0 | 1 | 2) => Promise<BlockPlan>;
  generateWeeklyPlan: (zone: string) => Promise<BlockPlan>;
  approvePlan: (planId: string) => Promise<void>;
  rejectPlan: (planId: string, reason?: string) => Promise<void>;
  generateAndApproveAllMonthly: (monthsAhead?: 0 | 1 | 2) => Promise<BulkPlanResult[]>;
  generateAndApproveAllWeekly: () => Promise<BulkPlanResult[]>;
}

export const useAppStore = create<AppState>((set, get) => ({
  zones: [],
  selectedZone: null,
  requests: [],
  notifications: [],
  modifications: [],
  plans: [],
  activeAssignments: [],
  isLoading: false,
  resetEpoch: 0,
  planRevision: 0,
  bumpPlanRevision: () => set({ planRevision: get().planRevision + 1 }),


  fetchZones: async () => {
    const zones = await api.get<ZoneSummary[]>("/api/v1/zones");
    set({ zones, selectedZone: get().selectedZone ?? zones[0]?.zone ?? null });
  },

  setSelectedZone: (zone) => set({ selectedZone: zone }),

  fetchRequests: async () => {
    set({ isLoading: true });
    try {
      const requests = await api.get<DefectRequest[]>("/api/v1/requests");
      set({ requests, isLoading: false });
    } catch (e) {
      set({ isLoading: false });
      throw e;
    }
  },

  fetchNotifications: async () => {
    const notifications = await api.get<Notification[]>("/api/v1/notifications");
    set({ notifications });
  },

  fetchModifications: async () => {
    const modifications = await api.get<ModificationRequest[]>("/api/v1/modifications");
    set({ modifications });
  },

  fetchPlans: async () => {
    // Every period of every zone — the plan pickers derive their month /
    // week options from this list.
    const plans = await api.get<BlockPlan[]>("/api/v1/plans?limit=1000");
    set({ plans });
  },

  refetchAll: async () => {
    set({ selectedZone: null, activeAssignments: [], plans: [], requests: [], modifications: [], notifications: [] });
    await get().fetchZones();
    await Promise.all([get().fetchRequests(), get().fetchModifications(), get().fetchPlans(), get().fetchNotifications(), get().fetchActiveWeeklyAssignments()]);
    set({ resetEpoch: get().resetEpoch + 1 });
  },

  startReset: async (confirm) => api.post<{ jobId: string }>("/api/v1/admin/reset", { confirm }),
  getResetStatus: async (jobId) => api.get<ResetJobStatus>(`/api/v1/admin/reset/${jobId}`),

  fetchActiveWeeklyAssignments: async () => {
    const zone = get().selectedZone;
    const plans = await api.get<BlockPlan[]>(`/api/v1/plans${qs({ zone: zone ?? undefined, horizon: "weekly", status: "approved" })}`);
    const latest = plans[0];
    if (!latest) {
      set({ activeAssignments: [] });
      return;
    }
    const assignments = await api.get<BlockAssignment[]>(`/api/v1/plans/${latest.planId}/assignments`);
    set({ activeAssignments: assignments });
  },

  submitRequest: async (body) => {
    const result = await api.post<{ defectId: string; outcome: string }>("/api/v1/requests", body);
    await get().fetchRequests();
    return result;
  },

  respondToReschedule: async (requestId, accept) => {
    await api.post(`/api/v1/requests/reschedule/${requestId}/respond`, { accept });
    await Promise.all([get().fetchModifications(), get().fetchRequests()]);
  },

  decideModification: async (requestId, approve, reason) => {
    await api.post(`/api/v1/modifications/${requestId}/decide`, { approve, reason });
    await Promise.all([get().fetchModifications(), get().fetchPlans(), get().fetchActiveWeeklyAssignments(), get().fetchRequests()]);
  },

  markNotificationRead: async (id) => {
    await api.post(`/api/v1/notifications/${id}/read`);
    set({ notifications: get().notifications.map((n) => (n.notificationId === id ? { ...n, isRead: true } : n)) });
  },

  markAllNotificationsRead: async () => {
    await api.post("/api/v1/notifications/read-all");
    set({ notifications: get().notifications.map((n) => ({ ...n, isRead: true })) });
  },

  clearRequest: async (defectId) => {
    await api.post(`/api/v1/requests/${defectId}/clear`);
    await get().fetchRequests();
  },

  generateMonthlyPlan: async (zone, monthsAhead = 1) => {
    const plan = await api.post<BlockPlan>("/api/v1/plans/monthly/generate", { zone, monthsAhead });
    await get().fetchPlans();
    return plan;
  },

  generateWeeklyPlan: async (zone) => {
    const plan = await api.post<BlockPlan>("/api/v1/plans/weekly/generate", { zone });
    await get().fetchPlans();
    return plan;
  },

  approvePlan: async (planId) => {
    await api.post(`/api/v1/plans/${planId}/approve`);
    await Promise.all([get().fetchPlans(), get().fetchActiveWeeklyAssignments(), get().fetchRequests()]);
  },

  rejectPlan: async (planId, reason) => {
    await api.post(`/api/v1/plans/${planId}/reject`, { reason });
    await get().fetchPlans();
  },

  generateAndApproveAllMonthly: async (monthsAhead = 1) => {
    const results = await api.post<BulkPlanResult[]>("/api/v1/plans/monthly/generate-approve-all", { monthsAhead });
    await Promise.all([get().fetchPlans(), get().fetchActiveWeeklyAssignments(), get().fetchRequests()]);
    return results;
  },

  generateAndApproveAllWeekly: async () => {
    const results = await api.post<BulkPlanResult[]>("/api/v1/plans/weekly/generate-approve-all", {});
    await Promise.all([get().fetchPlans(), get().fetchActiveWeeklyAssignments(), get().fetchRequests()]);
    return results;
  },
}));
