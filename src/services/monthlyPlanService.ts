// ──────────────────────────────────────────────────────────────────
// Monthly Planning Engine — Demo Priority & Planning Service
// ──────────────────────────────────────────────────────────────────
// This is a DETERMINISTIC DEMO implementation of the monthly planning engine.
// In production this would be backed by an ML-based priority model (XGBoost/LightGBM)
// with SHAP explanations.
import type {
  MonthlyJob, MonthlyClassification, TargetWeek,
  CoordinationGroup, DeptCapacity, MonthlyAlert, MonthlyPlanSummary,
  PriorityFactor, MonthlySeverity
} from '../types/monthlyPlan';
import { monthlyJobsRaw } from '../data/monthlyPlanData';

// ── DEPT CAPACITY ESTIMATES (demo values — historical averages) ──
const DEPT_MONTHLY_CAPACITY_HOURS: Record<string, number> = {
  ENGG: 60,
  TRD: 45,
  'S&T': 35,
};

function sevPoints(s: MonthlySeverity): number {
  return s === 'CRITICAL' ? 30 : s === 'HIGH' ? 20 : s === 'MEDIUM' ? 10 : 5;
}

function calculatePriority(job: typeof monthlyJobsRaw[0]): {
  score: number;
  breakdown: PriorityFactor[];
} {
  const breakdown: PriorityFactor[] = [];
  let score = 0;

  // Safety criticality
  const sc = sevPoints(job.safetyCriticality);
  breakdown.push({ factor: 'Safety criticality', points: sc, reason: `Safety criticality: ${job.safetyCriticality}` });
  score += sc;

  // Defect severity
  const sev = sevPoints(job.severity);
  breakdown.push({ factor: 'Defect severity', points: sev, reason: `Severity: ${job.severity}` });
  score += sev;

  // Asset criticality
  const ac = sevPoints(job.assetCriticality) * 0.6;
  breakdown.push({ factor: 'Asset criticality', points: Math.round(ac), reason: `Asset criticality: ${job.assetCriticality}` });
  score += ac;

  // Overdue
  const od = Math.min(job.overdueDays * 3, 20);
  if (od > 0) {
    breakdown.push({ factor: 'Overdue days', points: od, reason: `${job.overdueDays} days overdue` });
    score += od;
  }

  // Previous postponements
  const pp = Math.min(job.previousPostponements * 5, 15);
  if (pp > 0) {
    breakdown.push({ factor: 'Repeated postponements', points: pp, reason: `Postponed ${job.previousPostponements} time(s)` });
    score += pp;
  }

  // Due date urgency (within 7 days = high urgency)
  const daysUntilDue = Math.ceil(
    (new Date(job.dueDate).getTime() - Date.now()) / 86400000
  );
  if (daysUntilDue <= 7) {
    const urgency = Math.max(0, 10 - daysUntilDue);
    breakdown.push({ factor: 'Due date urgency', points: urgency, reason: `Due in ${Math.max(0, daysUntilDue)} days` });
    score += urgency;
  }

  // Corridor importance proxy (COR-A-B is the primary mainline)
  if (job.corridorId === 'COR-A-B') {
    breakdown.push({ factor: 'Mainline corridor', points: 5, reason: 'Asset on primary mainline corridor' });
    score += 5;
  }

  return { score: Math.min(Math.round(score), 100), breakdown };
}

function classify(score: number, job: typeof monthlyJobsRaw[0]): MonthlyClassification {
  if (job.safetyCriticality === 'CRITICAL' || job.severity === 'CRITICAL') return 'TARGET';
  if (score >= 50) return 'TARGET';
  if (score >= 35) return 'PREPARE';
  if (score >= 20) return 'DEFER';
  return 'REVIEW';
}

function assignWeek(job: MonthlyJob): TargetWeek {
  // Critical → Week 1 or 2
  if (job.safetyCriticality === 'CRITICAL' || job.priorityScore >= 80) return 1;
  if (job.priorityScore >= 60) return 2;
  if (job.priorityScore >= 40) return 3;
  return 4;
}

function detectCoordinationGroups(jobs: MonthlyJob[]): CoordinationGroup[] {
  const byCorridorWeek: Record<string, MonthlyJob[]> = {};

  for (const job of jobs) {
    if (job.classification !== 'TARGET' && job.classification !== 'PREPARE') continue;
    const key = `${job.corridorId}-W${job.targetWeek}`;
    if (!byCorridorWeek[key]) byCorridorWeek[key] = [];
    byCorridorWeek[key].push(job);
  }

  const groups: CoordinationGroup[] = [];
  let counter = 1;

  for (const [key, groupJobs] of Object.entries(byCorridorWeek)) {
    if (groupJobs.length < 2) continue;
    const depts = [...new Set(groupJobs.map(j => j.department))];
    if (depts.length < 2) continue; // needs multi-dept

    const corridorId = groupJobs[0].corridorId;
    const totalHours = groupJobs.reduce((s, j) => s + j.estimatedDurationHours, 0);

    groups.push({
      id: `CG-${counter++}`,
      corridorId,
      jobs: groupJobs.map(j => j.id),
      departments: depts as MonthlyJob['department'][],
      totalEstimatedHours: Math.round(totalHours * 10) / 10,
      benefit: `${depts.join(' + ')} can share one coordinated block on ${corridorId} saving separate interventions`,
    });
  }
  return groups;
}

export const monthlyPlanService = {
  /** Build the fully scored and classified monthly job list */
  buildPlan(): MonthlyJob[] {
    return monthlyJobsRaw.map(raw => {
      const { score, breakdown } = calculatePriority(raw);
      const cls = classify(score, raw);
      const job: MonthlyJob = {
        ...raw,
        priorityScore: score,
        priorityBreakdown: breakdown,
        classification: cls,
        targetWeek: null,
        actionLog: [],
      };
      if (cls === 'TARGET' || cls === 'PREPARE') {
        job.targetWeek = assignWeek(job);
      }
      return job;
    }).sort((a, b) => b.priorityScore - a.priorityScore);
  },

  /** Re-score and reclassify (called when new jobs added or controller clicks Recalculate) */
  recalculate(jobs: MonthlyJob[]): MonthlyJob[] {
    return jobs.map(job => {
      const { score, breakdown } = calculatePriority(job);
      const cls = job.controllerClassification ?? classify(score, job);
      const week = job.controllerTargetWeek ?? (cls === 'TARGET' || cls === 'PREPARE' ? assignWeek({ ...job, priorityScore: score }) : null);
      return { ...job, priorityScore: score, priorityBreakdown: breakdown, classification: cls, targetWeek: week };
    }).sort((a, b) => b.priorityScore - a.priorityScore);
  },

  buildSummary(jobs: MonthlyJob[]): MonthlyPlanSummary {
    const groups = detectCoordinationGroups(jobs);
    // assign coordinationGroupId to jobs
    for (const g of groups) {
      for (const jid of g.jobs) {
        const job = jobs.find(j => j.id === jid);
        if (job) job.coordinationGroupId = g.id;
      }
    }

    const alerts: MonthlyAlert[] = [];

    // Capacity per dept
    const deptCapacities: DeptCapacity[] = (['ENGG', 'TRD', 'S&T'] as const).map(dept => {
      const deptJobs = jobs.filter(j => j.department === dept && (j.classification === 'TARGET' || j.classification === 'PREPARE'));
      const workload = deptJobs.reduce((s, j) => s + j.estimatedDurationHours, 0);
      const capacity = DEPT_MONTHLY_CAPACITY_HOURS[dept];
      const pct = Math.round((workload / capacity) * 100);
      if (pct > 100) {
        alerts.push({
          id: `cap-${dept}`,
          type: 'WARNING',
          message: `${dept} workload (${Math.round(workload)}h) exceeds estimated monthly capacity (${capacity}h) by ${pct - 100}%.`,
        });
      }
      return { department: dept, estimatedWorkloadHours: Math.round(workload), estimatedCapacityHours: capacity, utilizationPct: pct, overloaded: pct > 100 };
    });

    const critical = jobs.filter(j => j.safetyCriticality === 'CRITICAL' || j.severity === 'CRITICAL');
    const critNotTargeted = critical.filter(j => j.classification !== 'TARGET').length;
    if (critNotTargeted > 0) {
      alerts.push({ id: 'crit-not-targeted', type: 'CRITICAL', message: `${critNotTargeted} critical job(s) are not included in this month's target.` });
    }

    const overdue = jobs.filter(j => j.overdueDays > 0);
    if (overdue.length > 0) {
      alerts.push({ id: 'overdue', type: 'WARNING', message: `${overdue.length} job(s) are overdue. Prioritise for Week 1–2.` });
    }

    if (groups.length > 0) {
      alerts.push({ id: 'coord', type: 'INFO', message: `${groups.length} multi-department coordination opportunit${groups.length > 1 ? 'ies' : 'y'} detected across corridors.` });
    }

    const approachingDue = jobs.filter(j => {
      const d = Math.ceil((new Date(j.dueDate).getTime() - Date.now()) / 86400000);
      return d >= 0 && d <= 7 && j.classification !== 'TARGET';
    });
    if (approachingDue.length > 0) {
      alerts.push({ id: 'due-soon', type: 'WARNING', message: `${approachingDue.length} job(s) have due dates within 7 days and are not yet targeted.` });
    }

    const multiPostponed = jobs.filter(j => j.previousPostponements > 1);
    if (multiPostponed.length > 0) {
      alerts.push({ id: 'multi-postponed', type: 'WARNING', message: `${multiPostponed.length} job(s) have been postponed more than once and need review.` });
    }

    const targeted = jobs.filter(j => j.classification === 'TARGET');
    const totalWorkload = jobs.filter(j => j.classification === 'TARGET' || j.classification === 'PREPARE')
      .reduce((s, j) => s + j.estimatedDurationHours, 0);
    const totalCapacity = Object.values(DEPT_MONTHLY_CAPACITY_HOURS).reduce((a, b) => a + b, 0);

    return {
      month: 'September 2026',
      totalBacklog: jobs.length,
      criticalJobs: critical.length,
      overdueJobs: overdue.length,
      targetedThisMonth: targeted.length,
      estimatedWorkloadHours: Math.round(totalWorkload),
      estimatedCapacityHours: totalCapacity,
      utilizationPct: Math.round((totalWorkload / totalCapacity) * 100),
      coordinationOpportunities: groups.length,
      deptCapacities,
      alerts,
      coordinationGroups: groups,
    };
  },

  getCoordinationGroups(jobs: MonthlyJob[]): CoordinationGroup[] {
    return detectCoordinationGroups(jobs);
  },
};
