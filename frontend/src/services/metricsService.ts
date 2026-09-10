import type { Plan, MaintenanceJob, CandidateWindow } from "../types/domain";

export const metricsService = {
  calculateMetrics: (plan: Plan, jobs: MaintenanceJob[], windows: CandidateWindow[]): Plan["metrics"] => {
    // Causally calculate metrics based on the plan assignments
    const assignments = plan.assignments;
    
    let criticalCount = 0;
    assignments.forEach(a => {
      a.jobs.forEach(jobId => {
        const job = jobs.find(j => j.id === jobId);
        if (job && job.severity === "A") criticalCount++;
      });
    });

    const totalHours = assignments.reduce((sum, a) => sum + a.durationHours, 0);
    
    // Utilization of candidate windows used in this plan
    const uniqueWindowsUsed = new Set(assignments.map(a => a.windowId)).size;
    const utilization = windows.length > 0 ? (uniqueWindowsUsed / windows.length) * 100 : 0;

    return {
      totalBlockGroups: assignments.length,
      totalBlockHours: totalHours,
      criticalJobsScheduled: criticalCount,
      assetDowntimeHours: totalHours, // Demo simplification: downtime = block hours
      corridorCapacityUtilization: utilization
    };
  }
};
