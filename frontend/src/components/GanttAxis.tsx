/** Hour ruler and gridlines shared by the Gantt views — every 3 h, IST. */

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24];
const label = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

/** A ruler row above the day rows; `labelWidth` matches the day-label column so the ticks line up with the tracks. */
export function TimeAxis({ labelWidth }: { labelWidth: string }) {
  return (
    <div className="flex items-center gap-2 px-3 pt-1.5 pb-0.5 select-none">
      <span className={`${labelWidth} shrink-0`} />
      <div className="relative flex-1 h-4">
        {HOURS.map((h) => (
          <span
            key={h}
            className="absolute top-0 text-[10px] text-ops-muted mono leading-4"
            style={{ left: `${(h / 24) * 100}%`, transform: h === 0 ? "none" : h === 24 ? "translateX(-100%)" : "translateX(-50%)" }}
          >
            {label(h)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Faint vertical lines at the same hours inside a day track; render first so bars sit on top. */
export function HourGrid() {
  return (
    <>
      {HOURS.slice(1, -1).map((h) => (
        <div key={h} className="absolute top-0 h-full w-px pointer-events-none" style={{ left: `${(h / 24) * 100}%`, background: "var(--ops-border)", opacity: h % 6 === 0 ? 1 : 0.5 }} />
      ))}
    </>
  );
}
