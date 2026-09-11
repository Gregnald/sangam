import { create } from "zustand";
import { api, qs } from "../lib/api";
import type {
  BlockAssignment,
  BlockPlan,
  BulkPlanResult,
  DefectRequest,
  ModificationRequest,
  Notification,
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
  mapRefreshKey: number;
  isLoading: boolean;

  fetchZones: () => Promise<void>;
  setSelectedZone: (zone: string | null) => void;
  fetchRequests: () => Promise<void>;
  fetchNotifications: () => Promise<void>;
  fetchModifications: () => Promise<void>;
  fetchPlans: () => Promise<void>;
  fetchActiveWeeklyAssignments: () => Promise<void>;
  bumpMapRefresh: () => void;

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
  mapRefreshKey: 0,
  isLoading: false,

  bumpMapRefresh: () => set({ mapRefreshKey: get().mapRefreshKey + 1 }),

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
    const plans = await api.get<BlockPlan[]>("/api/v1/plans");
    set({ plans });
  },

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
    get().bumpMapRefresh();
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
    get().bumpMapRefresh();
  },

  rejectPlan: async (planId, reason) => {
    await api.post(`/api/v1/plans/${planId}/reject`, { reason });
    await get().fetchPlans();
  },

  generateAndApproveAllMonthly: async (monthsAhead = 1) => {
    const results = await api.post<BulkPlanResult[]>("/api/v1/plans/monthly/generate-approve-all", { monthsAhead });
    await Promise.all([get().fetchPlans(), get().fetchActiveWeeklyAssignments(), get().fetchRequests()]);
    get().bumpMapRefresh();
    return results;
  },

  generateAndApproveAllWeekly: async () => {
    const results = await api.post<BulkPlanResult[]>("/api/v1/plans/weekly/generate-approve-all", {});
    await Promise.all([get().fetchPlans(), get().fetchActiveWeeklyAssignments(), get().fetchRequests()]);
    get().bumpMapRefresh();
    return results;
  },
}));
