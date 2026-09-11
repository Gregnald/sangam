import type { DefectRequest } from "../types/api";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  awaiting_dept_response: "Awaiting dept response",
  awaiting_controller: "Awaiting controller",
  cleared: "Cleared",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text-amber-400",
  scheduled: "text-emerald-400",
  awaiting_dept_response: "text-blue-400",
  awaiting_controller: "text-blue-400",
  cleared: "text-ops-muted",
};

const SEV_COLOR: Record<string, string> = { A: "text-red-400", B: "text-amber-400", C: "text-emerald-400" };

export function RequestsTable({
  requests,
  showDepartment,
  showZone,
  onSelect,
}: {
  requests: DefectRequest[];
  showDepartment?: boolean;
  showZone?: boolean;
  onSelect?: (r: DefectRequest) => void;
}) {
  const colCount = 8 + (showDepartment ? 1 : 0) + (showZone ? 1 : 0);
  return (
    <div className="border border-ops-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-black/20 text-ops-muted uppercase text-[10px]">
          <tr>
            <th className="text-left p-2">Corridor</th>
            {showZone && <th className="text-left p-2">Zone</th>}
            {showDepartment && <th className="text-left p-2">Dept</th>}
            <th className="text-left p-2">Defect</th>
            <th className="text-left p-2">Sev</th>
            <th className="text-left p-2">Score</th>
            <th className="text-left p-2">Due</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Deferred</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ops-border">
          {requests.length === 0 && (
            <tr>
              <td colSpan={colCount} className="p-4 text-center text-ops-muted">
                No requests.
              </td>
            </tr>
          )}
          {requests.map((r) => (
            <tr key={r.defectId} onClick={() => onSelect?.(r)} className={onSelect ? "cursor-pointer hover:bg-white/5" : ""}>
              <td className="p-2 text-ops-text mono">{r.corridorId}</td>
              {showZone && <td className="p-2 text-ops-muted mono">{r.zone ?? "—"}</td>}
              {showDepartment && <td className="p-2 text-ops-text">{r.department}</td>}
              <td className="p-2 text-ops-text">{r.defectType.replace(/_/g, " ")}</td>
              <td className={`p-2 font-semibold ${SEV_COLOR[r.severityCode]}`}>{r.severityCode}</td>
              <td className="p-2 text-ops-text mono">{r.priorityScore?.toFixed(1) ?? "—"}</td>
              <td className="p-2 text-ops-muted mono">{r.dueDate}</td>
              <td className={`p-2 ${STATUS_COLOR[r.workflowStatus]}`}>{STATUS_LABEL[r.workflowStatus]}</td>
              <td className="p-2 text-ops-muted">{r.deferCount > 0 ? r.deferCount : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
