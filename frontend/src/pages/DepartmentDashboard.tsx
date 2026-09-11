import { useEffect, useState } from "react";
import { TopBar } from "../components/TopBar";
import { RequestsTable } from "../components/RequestsTable";
import { ModificationList } from "../components/ModificationList";
import { WeeklySchedule } from "../components/WeeklySchedule";
import { HistoryPanel } from "../components/HistoryPanel";
import { MapTab } from "../components/MapTab";
import { RequestForm } from "../components/dept/RequestForm";
import { useAppStore } from "../store/appStore";
import { useAuthStore } from "../store/authStore";

const TABS = ["Requests", "Actions Needed", "This Week", "Map", "History"];

export function DepartmentDashboard() {
  const [tab, setTab] = useState("Requests");
  const [showForm, setShowForm] = useState(false);
  const role = useAuthStore((s) => s.role);
  const {
    requests, modifications, activeAssignments, zones, selectedZone,
    fetchZones, fetchRequests, fetchModifications, fetchActiveWeeklyAssignments, respondToReschedule, setSelectedZone,
  } = useAppStore();

  useEffect(() => {
    fetchZones();
    fetchRequests();
    fetchModifications();
  }, [fetchZones, fetchRequests, fetchModifications]);

  useEffect(() => {
    if (selectedZone) fetchActiveWeeklyAssignments();
  }, [selectedZone, fetchActiveWeeklyAssignments]);

  const pendingForDept = modifications.filter((m) => m.status === "pending_dept" || m.status === "pending_controller");

  return (
    <div className="flex flex-col h-screen bg-ops-bg">
      <TopBar tabs={TABS} active={tab} onTabChange={setTab} />
      {showForm && <RequestForm zone={selectedZone} onClose={() => setShowForm(false)} />}

      <main className="flex-1 overflow-y-auto p-5">
        {tab === "Requests" && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-ops-text">{role} — Block Requests</h2>
                <select
                  value={selectedZone ?? ""}
                  onChange={(e) => setSelectedZone(e.target.value || null)}
                  className="text-xs bg-black/20 border border-ops-border text-ops-text px-2 py-1"
                >
                  {zones.map((z) => (
                    <option key={z.zone ?? "none"} value={z.zone ?? ""}>
                      {z.zone} ({z.pendingRequests} pending)
                    </option>
                  ))}
                </select>
              </div>
              <button onClick={() => setShowForm(true)} className="px-3 py-1.5 bg-ops-accent text-white text-xs font-medium">
                + New Request
              </button>
            </div>
            <RequestsTable requests={requests} />
          </div>
        )}

        {tab === "Actions Needed" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">Actions Needed</h2>
            <ModificationList
              items={pendingForDept}
              mode="dept"
              onDeptRespond={(id, accept) => respondToReschedule(id, accept)}
            />
          </div>
        )}

        {tab === "This Week" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">This Week's Schedule — {role}</h2>
            <WeeklySchedule assignments={activeAssignments} department={role ?? undefined} />
          </div>
        )}

        {tab === "Map" && <MapTab />}

        {tab === "History" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">History</h2>
            <HistoryPanel scope="own" department={role ?? undefined} />
          </div>
        )}
      </main>
    </div>
  );
}
