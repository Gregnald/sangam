import type { Plan, MaintenanceJob, CandidateWindow, BlockAssignment } from "../types/domain";

export const optimizationService = {
  /**
   * Deterministic optimization simulator for frontend demonstration.
   */
  optimizePlan: (
    jobs: MaintenanceJob[],
    windows: CandidateWindow[],
    planId: string
  ): Plan => {
    const sortedJobs = [...jobs].sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0));
    const assignments: BlockAssignment[] = [];
    const usedWindows = new Set<string>();

    let assignmentIdCounter = 1;

    for (const job of sortedJobs) {
      if (job.status !== "open") continue;

      // Find a window on the same corridor that fits the job and is not fully utilized
      // (For this demo, we assume one window = one assignment group for simplicity)
      const window = windows.find(w => 
        w.corridorId === job.corridorId && 
        w.durationHours >= job.estimatedBlockHours &&
        !usedWindows.has(w.id)
      );

      if (window) {
        assignments.push({
          id: `ASG-${assignmentIdCounter++}`,
          planId,
          corridorId: window.corridorId,
          windowId: window.id,
          jobs: [job.id],
          departments: [job.department],
          start: window.start, // Assuming job starts at window start for demo
          end: new Date(new Date(window.start).getTime() + job.estimatedBlockHours * 3600000).toISOString(),
          durationHours: job.estimatedBlockHours,
          status: "proposed"
        });
        usedWindows.add(window.id);
      }
    }

    return {
      id: planId,
      name: `Optimized Plan ${planId}`,
      createdAt: new Date().toISOString(),
      horizon: "weekly",
      status: "proposed",
      assignments,
      metrics: {
        totalBlockGroups: assignments.length,
        totalBlockHours: assignments.reduce((acc, curr) => acc + curr.durationHours, 0),
        criticalJobsScheduled: assignments.filter(a => {
          const j = jobs.find(job => job.id === a.jobs[0]);
          return j?.severity === "A";
        }).length,
        assetDowntimeHours: assignments.reduce((acc, curr) => acc + curr.durationHours, 0), // Simplified
        corridorCapacityUtilization: usedWindows.size / (windows.length || 1) * 100
      }
    };
  }
};
