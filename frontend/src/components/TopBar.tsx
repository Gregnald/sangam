import { IST_TZ } from "../lib/dates";
import { useEffect, useState } from "react";
import { Bell, LogOut, RotateCcw } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useAppStore } from "../store/appStore";
import { ThemeToggle } from "./ThemeToggle";
import { ResetSystemDialog } from "./ResetSystemDialog";

const ROLE_LABEL: Record<string, string> = { CONTROLLER: "Section Controller", ENGG: "Engineering", SIGNAL: "Signal & Telecom", TRD: "Traction Distribution" };

export function TopBar({ tabs, active, onTabChange }: { tabs: string[]; active: string; onTabChange: (t: string) => void }) {
  const { displayName, role, logout } = useAuthStore();
  const { notifications, fetchNotifications, markNotificationRead, markAllNotificationsRead, focusRequest } = useAppStore();
  const [open, setOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const unread = notifications.filter((n) => !n.isRead).length;
  const initials = (displayName ?? role ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="h-14 bg-ops-panel border-b border-ops-border flex items-center justify-between px-4 shrink-0 relative z-20">
      <div className="flex items-center gap-5 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-md bg-ops-accent text-white text-[13px] font-bold flex items-center justify-center shadow-sm">S</span>
          <div className="leading-none">
            <p className="text-[13px] font-semibold text-ops-text tracking-wide">SANGAM</p>
            <p className="text-[10px] text-ops-muted mt-0.5">Block planning</p>
          </div>
        </div>
        <nav className="flex items-center gap-0.5 p-0.5 bg-ops-inset rounded-lg">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${active === t ? "bg-ops-panel text-ops-text shadow-sm" : "text-ops-muted hover:text-ops-text"}`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <button onClick={() => setOpen((o) => !o)} className="w-8 h-8 rounded-md text-ops-muted hover:text-ops-text hover:bg-ops-hover flex items-center justify-center relative" title="Notifications">
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[9px] min-w-3.5 h-3.5 px-0.5 rounded-full flex items-center justify-center font-semibold">{unread}</span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 top-10 w-80 max-h-96 overflow-y-auto bg-ops-panel border border-ops-border z-30">
              <div className="flex items-center justify-between px-3 py-2 border-b border-ops-border">
                <span className="text-xs font-semibold text-ops-text">Notifications</span>
                {unread > 0 && (
                  <button onClick={() => markAllNotificationsRead()} className="text-[11px] text-ops-accent">
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 && <p className="text-xs text-ops-muted p-3">No notifications.</p>}
              {notifications.map((n) => (
                <div
                  key={n.notificationId}
                  onClick={() => {
                    if (!n.isRead) markNotificationRead(n.notificationId);
                    if (n.relatedDefectId) {
                      focusRequest(n.relatedDefectId);
                      setOpen(false);
                    }
                  }}
                  className={`px-3 py-2 text-xs border-b border-ops-border last:border-0 cursor-pointer hover:bg-ops-hover ${n.isRead ? "text-ops-muted" : "text-ops-text bg-ops-raise"}`}
                  title={n.relatedDefectId ? "Open this request" : undefined}
                >
                  {n.message}
                  <div className="flex items-center justify-between text-[10px] text-ops-muted mt-1">
                    <span>{new Date(n.createdAt).toLocaleString(undefined, { timeZone: IST_TZ })}</span>
                    {n.relatedDefectId && <span className="text-ops-accent">open request →</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <ThemeToggle />
        {role === "CONTROLLER" && (
          <button onClick={() => setResetOpen(true)} title="Wipe everything except login accounts and reload the network" className="w-8 h-8 rounded-md text-ops-muted hover:text-red-400 hover:bg-ops-hover flex items-center justify-center">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        <div className="flex items-center gap-2 pl-2 ml-1 border-l border-ops-border">
          <span className="w-7 h-7 rounded-full bg-ops-inset-strong text-[10px] font-semibold text-ops-text flex items-center justify-center">{initials}</span>
          <div className="leading-none hidden md:block">
            <p className="text-xs font-medium text-ops-text">{displayName}</p>
            <p className="text-[10px] text-ops-muted mt-0.5">{ROLE_LABEL[role ?? ""] ?? role}</p>
          </div>
          <button onClick={logout} className="w-8 h-8 rounded-md text-ops-muted hover:text-ops-text hover:bg-ops-hover flex items-center justify-center" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
      <ResetSystemDialog open={resetOpen} onClose={() => setResetOpen(false)} />
    </header>
  );
}
