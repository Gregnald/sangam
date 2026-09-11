import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAppStore } from "../store/appStore";

interface BacklogResult {
  rowsRead: number;
  rowsIngested: number;
  rowsConformed: number;
  errors: string[];
  scheduled: number;
  rescheduleOffered: number;
  preemptionPending: number;
  stillPending: number;
  modelPromoted: boolean;
}

interface ScheduleResult {
  rowsRead: number;
  rowsUsed: number;
  unknownStations: string[];
  corridorsAdded: number;
  corridorsUpdated: number;
  traversalsAdded: number;
  windowsAdded: number;
}

interface GoodsForecastResult {
  rowsRead: number;
  bandsInserted: number;
  bandsUpdated: number;
  errors: string[];
  windowsAffected: number;
}

const DEPARTMENTS = [
  { value: "ENGG", label: "Engineering (TMS)" },
  { value: "SIGNAL", label: "Signal & Telecom (SMMS)" },
  { value: "TRD", label: "Traction Distribution (TDMS)" },
] as const;

function BacklogUploadCard({ department, label }: { department: string; label: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BacklogResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("department", department);
      form.append("file", file);
      const res = await api.postForm<BacklogResult>("/api/v1/ingest/backlog", form);
      setResult(res);
      await Promise.all([useAppStore.getState().fetchRequests(), useAppStore.getState().fetchZones(), useAppStore.getState().fetchModifications()]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-ops-border p-3">
      <h3 className="text-xs font-semibold text-ops-text mb-2">{label}</h3>
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-[11px] text-ops-muted flex-1"
        />
        <button disabled={!file || busy} onClick={upload} className="px-3 py-1.5 bg-ops-accent disabled:opacity-40 text-white text-xs">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
      {result && (
        <div className="text-[11px] text-ops-muted mt-2 space-y-1">
          <p>
            Read {result.rowsRead} rows · ingested {result.rowsIngested} · new to backlog {result.rowsConformed}
            {result.rowsConformed > 0 && <> · model {result.modelPromoted ? "retrained and promoted" : "retrained (kept existing, no improvement)"}</>}
          </p>
          {result.rowsConformed > 0 && (
            <p>
              Of the new rows: <span className="text-emerald-400">{result.scheduled} scheduled immediately</span>
              {result.rescheduleOffered > 0 && <>, <span className="text-blue-400">{result.rescheduleOffered} offered a reschedule</span></>}
              {result.preemptionPending > 0 && <>, <span className="text-amber-400">{result.preemptionPending} flagged for a priority-bump approval</span></>}
              {result.stillPending > 0 && (
                <>
                  , <span className="text-ops-muted">{result.stillPending} still pending</span>
                  {" "}(no approved weekly plan yet to slot into — they'll be included the next time one is generated)
                </>
              )}
            </p>
          )}
          {result.errors.length > 0 && (
            <details>
              <summary className="text-amber-400 cursor-pointer">{result.errors.length} row(s) had problems</summary>
              <ul className="mt-1 space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function ScheduleUploadCard() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.postForm<ScheduleResult>("/api/v1/ingest/schedule", form);
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-ops-border p-3">
      <h3 className="text-xs font-semibold text-ops-text mb-2">Railway Schedule</h3>
      <p className="text-[11px] text-ops-muted mb-2">
        Columns: <span className="mono">train_number, train_name, station_code, arrival, departure, day</span> — one row per stop, in stop order.
      </p>
      <div className="flex items-center gap-2">
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[11px] text-ops-muted flex-1" />
        <button disabled={!file || busy} onClick={upload} className="px-3 py-1.5 bg-ops-accent disabled:opacity-40 text-white text-xs">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
      {result && (
        <div className="text-[11px] text-ops-muted mt-2 space-y-1">
          <p>
            Read {result.rowsRead} rows, used {result.rowsUsed} · corridors added {result.corridorsAdded} · corridors updated {result.corridorsUpdated} ·
            traversals added {result.traversalsAdded} · windows added {result.windowsAdded}
          </p>
          {result.unknownStations.length > 0 && (
            <details>
              <summary className="text-amber-400 cursor-pointer">{result.unknownStations.length} unrecognized station code(s)</summary>
              <p className="mt-1 mono">{result.unknownStations.join(", ")}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function GoodsForecastUploadCard() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GoodsForecastResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.postForm<GoodsForecastResult>("/api/v1/ingest/goods-forecast", form);
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-ops-border p-3">
      <h3 className="text-xs font-semibold text-ops-text mb-2">Goods Train Forecast (Control Office)</h3>
      <p className="text-[11px] text-ops-muted mb-2">
        Columns: <span className="mono">corridor_id, forecast_date, band_start, band_end, train_count</span> — one row per corridor, date and time band
        (HH:MM) in which the COA expects freight paths. The planner treats each band as occupied when generating weekly and monthly plans.
      </p>
      <div className="flex items-center gap-2">
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[11px] text-ops-muted flex-1" />
        <button disabled={!file || busy} onClick={upload} className="px-3 py-1.5 bg-ops-accent disabled:opacity-40 text-white text-xs">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
      {result && (
        <div className="text-[11px] text-ops-muted mt-2 space-y-1">
          <p>
            Read {result.rowsRead} rows · {result.bandsInserted} new bands · {result.bandsUpdated} updated ·{" "}
            <span className="text-amber-400">{result.windowsAffected} candidate block windows now clipped or removed</span>
          </p>
          {result.errors.length > 0 && (
            <details>
              <summary className="text-amber-400 cursor-pointer">{result.errors.length} row(s) had problems</summary>
              <ul className="mt-1 space-y-0.5">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

export function IngestionPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ops-text mb-1">Data Ingestion</h2>
        <p className="text-xs text-ops-muted">
          Upload each department's backlog as an .xlsx export (optionally with <span className="mono">requested_window_start</span> /{" "}
          <span className="mono">requested_window_end</span> columns for a preferred block time), the network's train schedule as an .xlsx
          timetable, and the Control Office goods-train forecast. Backlog rows land in the request lifecycle exactly as if the department had
          submitted them directly.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {DEPARTMENTS.map((d) => (
          <BacklogUploadCard key={d.value} department={d.value} label={`${d.label} Backlog`} />
        ))}
        <ScheduleUploadCard />
        <GoodsForecastUploadCard />
      </div>
    </div>
  );
}
