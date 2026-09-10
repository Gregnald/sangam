import type { MaintenanceJob } from "../types/domain";

export const priorityService = {
  /**
   * Demo Priority Engine using a deterministic risk/priority formula.
   */
  calculatePriorityScore: (job: MaintenanceJob): MaintenanceJob => {
    let score = 0;
    const explanation: { factor: string; score: number }[] = [];

    // Severity factor
    let sevScore = 0;
    if (job.severity === "A") sevScore = 40;
    else if (job.severity === "B") sevScore = 20;
    else if (job.severity === "C") sevScore = 10;
    score += sevScore;
    explanation.push({ factor: `Severity (${job.severity}) impact`, score: sevScore });

    // Overdue factor
    const overdueScore = Math.min(job.daysOverdue * 5, 30);
    score += overdueScore;
    if (overdueScore > 0) {
      explanation.push({ factor: "Overdue duration", score: overdueScore });
    }

    // Asset impact (Speed restriction)
    if (job.speedRestrictionActive) {
      score += 20;
      explanation.push({ factor: "Asset impact (Speed restriction)", score: 20 });
    }

    // Traffic context proxy (demo)
    const trafficScore = 5; 
    score += trafficScore;
    explanation.push({ factor: "Traffic context proxy", score: trafficScore });
    
    // Duration penalty (longer jobs slightly less priority to fit, just a demo heuristic)
    const durationScore = Math.max(0, 5 - job.estimatedBlockHours);
    score += durationScore;
    explanation.push({ factor: "Duration efficiency", score: durationScore });

    return {
      ...job,
      priorityScore: Math.min(100, score),
      priorityExplanation: explanation
    };
  }
};
