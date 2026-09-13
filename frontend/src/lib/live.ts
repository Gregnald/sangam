/**
 * Live updates. One EventSource per signed-in session; the server sends a
 * `change` frame whenever anything changed (a plan approved, a block
 * placed, a request submitted — by anyone, or by the clock). We refetch
 * the store and bump the plan revision so every open panel, Gantt and KPI
 * card redraws itself. Reconnection is EventSource's own.
 */
import { API_BASE } from "./api";
import { useAppStore } from "../store/appStore";

let source: EventSource | null = null;
let timer: number | null = null;

function refetch() {
  const s = useAppStore.getState();
  s.refreshAll().catch(() => undefined);
  s.bumpPlanRevision();
}

export function connectLive(token: string) {
  disconnectLive();
  source = new EventSource(`${API_BASE}/api/v1/events/stream?token=${encodeURIComponent(token)}`);
  source.addEventListener("change", () => {
    // Several mutations often land within a second (a sweep, an approval
    // that derives a weekly plan) — coalesce them into one refetch.
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      refetch();
    }, 400);
  });
  source.onerror = () => {
    // EventSource reconnects by itself; nothing to do but wait.
  };
}

export function disconnectLive() {
  if (timer) {
    window.clearTimeout(timer);
    timer = null;
  }
  source?.close();
  source = null;
}
