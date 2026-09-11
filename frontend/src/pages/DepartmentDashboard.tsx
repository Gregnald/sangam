import { useEffect, useState } from "react";
import { TopBar } from "../components/TopBar";
import { RequestsTable } from "../components/RequestsTable";
import { ModificationList } from "../components/ModificationList";
import { MyBlocks } from "../components/dept/MyBlocks";
import { DeptPlanView } from "../components/dept/DeptPlanView";
import { HistoryPanel } from "../components/HistoryPanel";
import { RequestForm } from "../components/dept/RequestForm";
import { useAppStore } from "../store/appStore";
import { useAuthStore } from "../store/authStore";

const TABS = ["Requests", "My Blocks", "Actions Needed", "Plan", "History"];

export function DepartmentDashboard() {
  const [tab, setTab] = useState("Requests");
  const [showForm, setShowForm] = useState(false);
  const role = useAuthStore((s) => s.role);
  const {
    requests, modifications, zones, selectedZone,
    fetchZones, fetchRequests, fetchModifications, respondToReschedule, setSelectedZone,
  } = useAppStore();

  useEffect(() => {
    fetchZones();
    fetchRequests();
    fetchModifications();
    // The backend reconciles the backlog with the clock every minute
    // (completed blocks, lapsed offers); pick those changes up.
    const interval = setInterval(fetchRequests, 60000);
    return () => clearInterval(interval);
  }, [fetchZones, fetchRequests, fetchModifications]);

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
                  className="text-xs bg-ops-inset border border-ops-border text-ops-text px-2 py-1"
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

        {tab === "My Blocks" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">{role} — My Blocks</h2>
            <MyBlocks requests={requests} />
          </div>
        )}

        {tab === "Plan" && (
          <div>
            <h2 className="text-sm font-semibold text-ops-text mb-3">Published Plans</h2>
            <DeptPlanView />
          </div>
        )}


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
