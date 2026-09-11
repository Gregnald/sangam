import type { BlockAssignment } from "../types/api";

const DEPT_COLOR: Record<string, string> = {
  ENGG: "bg-blue-600",
  SIGNAL: "bg-purple-600",
  TRD: "bg-orange-600",
};

export function WeeklySchedule({ assignments, department }: { assignments: BlockAssignment[]; department?: string }) {
  const grouped = new Map<string, BlockAssignment[]>();
  for (const a of assignments) {
    const key = a.jointBlockGroupId ?? a.assignmentId;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(a);
    else grouped.set(key, [a]);
  }

  const groups = Array.from(grouped.values()).sort((a, b) => a[0].allocatedStart.localeCompare(b[0].allocatedStart));
  const visible = department ? groups.filter((g) => g.some((a) => a.department === department)) : groups;

  return (
    <div className="space-y-1.5">
      {visible.length === 0 && <p className="text-xs text-ops-muted p-4 border border-ops-border">No blocks scheduled this week.</p>}
      {visible.map((group) => {
        const depts = Array.from(new Set(group.map((a) => a.department)));
        const isJoint = depts.length > 1;
        return (
          <div key={group[0].assignmentId} className={`border p-2.5 flex items-center justify-between ${isJoint ? "border-ops-accent bg-ops-accent/10" : "border-ops-border"}`}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                {depts.map((d) => (
                  <span key={d} className={`text-[10px] font-semibold text-white px-1.5 py-0.5 ${DEPT_COLOR[d]}`}>
                    {d}
                  </span>
                ))}
                {isJoint && <span className="text-[10px] text-ops-accent font-semibold">JOINT BLOCK</span>}
              </div>
              <p className="text-xs text-ops-text mono">{group[0].corridorId}</p>
            </div>
            <div className="text-right text-[11px] text-ops-muted mono">
              {new Date(group[0].allocatedStart).toLocaleString()} —{" "}
              {new Date(group.reduce((max, a) => (a.allocatedEnd > max ? a.allocatedEnd : max), group[0].allocatedEnd)).toLocaleTimeString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
