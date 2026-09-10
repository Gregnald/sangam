import { create } from 'zustand';
import type { MaintenanceJob, Corridor, CandidateWindow, Plan, NetworkTopology, ScheduleEvent, Train } from "../types/domain";
import { maintenanceService } from '../services/maintenanceService';
import { corridorService } from '../services/corridorService';
import { timetableService } from '../services/timetableService';
import { availabilityService } from '../services/availabilityService';
import { priorityService } from '../services/priorityService';
import { optimizationService } from '../services/optimizationService';
import { metricsService } from '../services/metricsService';

interface AppState {
  jobs: MaintenanceJob[];
  topology: NetworkTopology | null;
  corridors: Corridor[];
  trains: Train[];
  schedules: ScheduleEvent[];
  candidateWindows: CandidateWindow[];
  baselinePlan: Plan | null;
  proposedPlan: Plan | null;
  
  isLoading: boolean;
  
  // Actions
  fetchInitialData: () => Promise<void>;
  runOptimization: () => void;
  updateProposedPlan: (plan: Plan) => void;
  addJob: (job: MaintenanceJob) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  jobs: [],
  topology: null,
  corridors: [],
  trains: [],
  schedules: [],
  candidateWindows: [],
  baselinePlan: null,
  proposedPlan: null,
  isLoading: false,

  fetchInitialData: async () => {
    set({ isLoading: true });
    try {
      const [rawJobs, topology, corridors, trains, schedules] = await Promise.all([
        maintenanceService.getJobs(),
        corridorService.getTopology(),
        corridorService.getCorridors(),
        timetableService.getTrains(),
        timetableService.getSchedules(),
      ]);

      // 1. Prioritize Jobs
      const jobs = rawJobs.map(job => priorityService.calculatePriorityScore(job));

      // 2. Derive Candidate Windows causally
      const baseDate = "2026-08-31T00:00:00Z";
      const candidateWindows = availabilityService.deriveCandidateWindows(corridors, schedules, baseDate, 24);

      // 3. Create a mock baseline plan (what is currently scheduled without optimization)
      // For demo, let's say baseline has 0 assignments initially or some naive assignments
      const baselinePlan: Plan = {
        id: "baseline-1",
        name: "Current Baseline",
        createdAt: new Date().toISOString(),
        horizon: "weekly",
        status: "approved",
        assignments: [],
        metrics: {
          totalBlockGroups: 0,
          totalBlockHours: 0,
          criticalJobsScheduled: 0,
          assetDowntimeHours: 0,
          corridorCapacityUtilization: 0
        }
      };

      set({ jobs, topology, corridors, trains, schedules, candidateWindows, baselinePlan, isLoading: false });
    } catch (e) {
      console.error(e);
      set({ isLoading: false });
    }
  },

  runOptimization: () => {
    const { jobs, candidateWindows } = get();
    // 4. Run optimization
    const proposedPlan = optimizationService.optimizePlan(jobs, candidateWindows, "proposed-1");
    
    // Recalculate metrics just to be sure causal chain is used
    proposedPlan.metrics = metricsService.calculateMetrics(proposedPlan, jobs, candidateWindows);
    
    set({ proposedPlan });
  },

  updateProposedPlan: (plan: Plan) => {
    set({ proposedPlan: plan });
  },

  addJob: (rawJob: MaintenanceJob) => {
    // Run the new job through the existing priority engine
    const scoredJob = priorityService.calculatePriorityScore(rawJob);
    set(state => ({ jobs: [...state.jobs, scoredJob] }));
  }
}));
