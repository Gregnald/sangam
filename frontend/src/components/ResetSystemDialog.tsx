import { useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { useAppStore } from "../store/appStore";
import type { ResetJobStatus } from "../types/api";

const STAGE_TEXT: Record<string, string> = {
  pause_clock: "Pausing the clock sync",
  wipe_database: "Wiping the database (login accounts kept)",
  delete_models: "Deleting trained models",
  load_network: "Loading stations, corridors and the bundled timetable from mapData/ — this takes a few minutes",
  build_windows: "Building the free-window calendar",
  seed_compatibility: "Seeding compatibility defaults",
  resume_clock: "Resuming the clock sync",
  done: "Done",
};

/**
 * Controller-only. Wipes everything except login accounts and reloads the
 * network — the state of a fresh install. Irreversible, so it asks for the
 * word RESET, then shows the background job's progress and refetches all
 * app state when it finishes.
 */
export function ResetSystemDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { startReset, getResetStatus, refetchAll } = useAppStore();
  const [confirm, setConfirm] = useState("");
  const [job, setJob] = useState<ResetJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirm("");
      setJob(null);
      setError(null);
      setPhase("idle");
    }
  }, [open]);

  useEffect(() => () => {
    if (timer.current) window.clearInterval(timer.current);
  }, []);

  function poll(jobId: string) {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      try {
        const status = await getResetStatus(jobId);
        setJob(status);
        if (status.status !== "running") {
          if (timer.current) window.clearInterval(timer.current);
          timer.current = null;
          if (status.status === "done") {
            await refetchAll();
            setPhase("done");
          } else {
            setPhase("failed");
          }
        }
      } catch (e) {
        if (timer.current) window.clearInterval(timer.current);
        timer.current = null;
        setError(e instanceof ApiError && e.status === 404 ? "The reset job is no longer tracked — the server restarted. Reload the page and check the data." : String(e));
        setPhase("failed");
      }
    }, 1500);
  }

  async function run() {
    setError(null);
    setPhase("running");
    try {
      const res = await startReset(confirm);
      poll(res.jobId);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          const body = JSON.parse(e.message) as { jobId?: string };
          if (body.jobId) {
            poll(body.jobId);
            return;
          }
        } catch {
          // fall through
        }
        setError("A reset is already running.");
      } else {
        setError(e instanceof ApiError ? e.message : String(e));
      }
      setPhase("failed");
    }
  }

  if (!open) return null;
  const busy = phase === "running";
  const stats = (job?.stats ?? {}) as { network?: Record<string, number>; windows?: number; models_deleted?: number };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
      <div className="bg-ops-panel border border-ops-border w-full max-w-lg p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-red-400">Reset the whole system</h3>

        {phase === "idle" && (
          <>
            <div className="text-xs text-ops-muted space-y-2">
              <p className="text-ops-text">This deletes, permanently:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                <li>every block request and the whole backlog history</li>
                <li>every plan (approved, pending, rejected, superseded), its assignments and history</li>
                <li>reschedule / bump requests and all notifications</li>
                <li>goods-train forecasts, uploaded timetables, compatibility edits and learned decisions</li>
                <li>trained models (priority ranker, pairwise compatibility)</li>
              </ul>
              <p>
                <span className="text-ops-text">Kept:</span> the four login accounts. <span className="text-ops-text">Reloaded:</span> stations, corridors and the bundled
                timetable from <span className="mono">mapData/</span>, a fresh 35-day free-window calendar, and the default compatibility matrices — exactly
                like a fresh install. Takes a few minutes.
              </p>
            </div>
            <label className="block text-xs text-ops-muted">
              Type <span className="mono text-ops-text">RESET</span> to confirm
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoFocus
                className="mt-1 w-full text-sm bg-ops-inset border border-ops-border text-ops-text px-2 py-1.5 mono"
                placeholder="RESET"
              />
            </label>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={onClose} className="px-3 py-1.5 text-xs border border-ops-border text-ops-muted">
                Cancel
              </button>
              <button onClick={run} disabled={confirm !== "RESET"} className="px-3 py-1.5 text-xs bg-red-600 text-white disabled:opacity-40">
                Reset everything
              </button>
            </div>
          </>
        )}

        {phase !== "idle" && (
          <>
            <div className="h-1.5 bg-ops-inset-strong">
              <div className={`h-full ${phase === "failed" ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${job?.progress ?? 0}%` }} />
            </div>
            <p className="text-xs text-ops-text">
              {phase === "running" && (job?.stage ? STAGE_TEXT[job.stage] ?? job.stage : "Starting…")}
              {phase === "done" && "Done — the system is fresh. Every tab has been reloaded."}
              {phase === "failed" && <span className="text-red-400">Failed: {job?.error ?? error ?? "unknown error"}</span>}
            </p>
            {job && job.log.length > 0 && (
              <pre className="text-[10px] text-ops-muted bg-ops-inset border border-ops-border p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">{job.log.slice(-8).join("\n")}</pre>
            )}
            {phase === "done" && stats.network && (
              <p className="text-[11px] text-ops-muted">
                Loaded {stats.network.stations} stations · {stats.network.corridors} corridors · {stats.network.traversals} train passages · {stats.network.assets} assets ·{" "}
                {stats.windows} free windows · removed {stats.models_deleted} model file(s).
              </p>
            )}
            {busy && <p className="text-[11px] text-ops-muted">You can keep this open or close it — the reset continues on the server.</p>}
            <div className="flex justify-end">
              <button onClick={onClose} className="px-3 py-1.5 text-xs border border-ops-border text-ops-muted">
                {busy ? "Hide" : "Close"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
