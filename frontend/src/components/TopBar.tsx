import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { useAuthStore } from "../store/authStore";
import { useAppStore } from "../store/appStore";

export function TopBar({ tabs, active, onTabChange }: { tabs: string[]; active: string; onTabChange: (t: string) => void }) {
  const { displayName, role, logout } = useAuthStore();
  const { notifications, fetchNotifications, markNotificationRead, markAllNotificationsRead } = useAppStore();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const unread = notifications.filter((n) => !n.isRead).length;

  return (
    <header className="h-14 bg-ops-panel border-b border-ops-border flex items-center justify-between px-5 shrink-0 relative">
      <div className="flex items-center gap-6">
        <span className="text-sm font-semibold text-ops-text tracking-wide">SANGAM</span>
        <nav className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              className={`px-3 py-1.5 text-xs font-medium ${active === t ? "bg-ops-accent text-white" : "text-ops-muted hover:text-ops-text"}`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative">
          <button onClick={() => setOpen((o) => !o)} className="p-1.5 text-ops-muted hover:text-ops-text relative">
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-600 text-white text-[9px] w-3.5 h-3.5 rounded-full flex items-center justify-center">
                {unread}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 top-9 w-80 max-h-96 overflow-y-auto bg-ops-panel border border-ops-border shadow-lg z-30">
              <div className="flex items-center justify-between px-3 py-2 border-b border-ops-border">
                <span className="text-xs font-medium text-ops-text">Notifications</span>
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
                  onClick={() => !n.isRead && markNotificationRead(n.notificationId)}
                  className={`px-3 py-2 text-xs border-b border-ops-border last:border-0 cursor-pointer ${n.isRead ? "text-ops-muted" : "text-ops-text bg-white/5"}`}
                >
                  {n.message}
                  <div className="text-[10px] text-ops-muted mt-1">{new Date(n.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs font-medium text-ops-text">{displayName}</p>
          <p className="text-[10px] text-ops-muted">{role}</p>
        </div>
        <button onClick={logout} className="text-xs text-ops-muted hover:text-ops-text border border-ops-border px-2 py-1">
          Sign out
        </button>
      </div>
    </header>
  );
}
