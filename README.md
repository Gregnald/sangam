# SANGAM — Block Planning & Coordination

A working system for coordinating railway maintenance block requests across
Engineering, Signal & Telecom, and Traction Distribution departments, with a
controller approval workflow, instead of each department requesting blocks
independently through a spreadsheet-style process.

## What's in here

- **Real network data**: stations, corridors, and train timetables come from
  `mapData/` (stations.json, trains.json, schedules.json) — not a live API
  pull, not synthetic geography. Corridors are derived from real adjacent-stop
  sequences in the timetable data; corridor occupancy (which corridors have a
  train on them right now) is computed from the same data.
- **A trained priority model**: XGBoost learning-to-rank with a hard
  safety-floor rule and SHAP explanations, scoring every open request.
- **A real optimizer**: Google OR-Tools CP-SAT solves the actual block
  assignment problem, respecting a department-compatibility matrix and
  corridor capacity.
- **Control Office goods-train forecast**: freight paths aren't in the
  passenger timetable, so the COA's per-corridor/per-day forecast is
  ingested separately (`core.goods_train_forecasts`) and carved out of the
  candidate block windows before the optimizer and the live request workflow
  see them. The Gantt draws forecast bands as a red hatch so a clipped "free"
  window reads as such.
- **Asset-availability KPIs on every plan**: availability % of the corridors
  under possession (and of the whole zone), possession hours vs job hours,
  block events and how many are shared/multi-department, downtime saved by
  bundling, backlog placed (severity-A, speed restrictions, overdue), on-time
  vs late, passenger trains affected (always 0 by construction — and shown to
  prove it), and goods paths protected vs conflicting.
- **A request lifecycle with a controller in the loop**: new requests either
  auto-schedule, get offered an alternate window (which the requesting
  department must accept), or — if high-priority enough — request bumping an
  already-scheduled lower-priority block. Bumping and accepted reschedules
  both require controller approval before anything changes. Everyone affected
  gets notified.
- **Login**: four accounts (`engg_dept`, `trd_dept`, `snt_dept`, `controller`),
  passwords bcrypt-hashed in the database. Each role sees its own dashboard.
- **A live map of the whole Indian rail network**, styled with a small MapCSS
  interpreter, colored by real-time status: red = blocked, amber = a train is
  currently running through it, green = clear. Each corridor shows its UP/DOWN
  direction labels, and the map has a date/time control to simulate what the
  network looked like (or will look like) at any moment, not just right now.
  Clicking a corridor opens its day-by-day block schedule for any week you
  pick, including who's working and when.
- **Per-block compatibility overrides**: the department-pair matrix has a
  sensible default, but the controller can override it for one exact
  corridor/day/window from the Compatibility tab when a specific block needs
  different rules than the default.

## Time zone

Every "which day is this?" decision — the window calendar, plan horizons,
the Gantt's day rows — is an Indian Railways operational day. The API pins
its Postgres session to `Asia/Kolkata` (`backend/app/db.py`), so `::date`
casts and returned timestamps agree with that calendar regardless of the
container's default (UTC). Timestamps come back from the API with a `+05:30`
offset; the frontend renders in the browser's local time, which for the
intended deployment is the same.

## Backend seed data

The only made-up data is the *starting* backlog: a small random set of block
requests per department, dated within the current month, standing in for
"what each department has already requested this month" (there is no public
dataset of real TMS/SMMS/TDMS defect records — that data is safety-sensitive
and internal). Everything submitted after that goes through the real request
workflow below.

## How a request actually moves through the system

1. A department submits a request (corridor, asset, defect type, severity,
   duration, due date, optionally a preferred window).
2. The system tries to fit it into the current week's approved plan:
   - Fits at the requested time (or anywhere, if no time was specified) →
     scheduled immediately, no approval needed.
   - Doesn't fit, but the request's priority score beats an already-scheduled
     lower-priority job by the configured margin → a **bump request** goes to
     the controller. Approving it returns the bumped job to the backlog
     (notifying its department) and schedules the new one.
   - Doesn't fit and isn't eligible to bump anyone → if a different window on
     the same corridor works, that's offered to the **requesting department**
     as a reschedule. They accept or reject it; accepting sends it to the
     controller for approval (since it changes the published plan); rejecting
     returns it to the backlog.
   - Nothing fits anywhere this week → stays in the backlog. A request that
     keeps missing cycles gets a rising `defer_count`, which feeds back into
     its priority score — so it doesn't starve indefinitely.
   - Re-generating a period that already has an approved plan re-solves the
     jobs that plan held together with the current backlog (they are not
     silently left out). If the new plan is approved and doesn't place some
     of them, they go back to the backlog with `defer_count + 1` rather than
     staying marked "scheduled" with no live block anywhere.
3. Monthly and weekly plans are generated by the controller, not automatically:
   - **Generate Monthly Plan** solves next month's or the month after's
     backlog for a zone — the current month is never blindly regenerated this
     way, since it's usually already committed to.
   - **Approving** it publishes the month and also derives and auto-approves
     the first week's plan from it (the exact slice of the monthly solve that
     falls in week 1 — not a separate solve), unless that week already has its
     own approved weekly plan.
   - For week 2 onward, the controller runs **Generate Next Weekly Plan** at
     the start of each week and approves it separately.
   - **Regenerate Current Month** re-solves only what's left of the current
     month: days that have already passed, and any week that already has its
     own approved weekly plan, are frozen exactly as they stand; everything
     else is re-optimized using whatever is currently in the backlog.
   - Any plan awaiting approval can also be **rejected** — it's marked
     rejected and left out of what's live, without touching the plan it would
     have replaced.
   - Every generation and approval is snapshotted into plan history (both the
     as-proposed and as-approved versions), browsable by department and
     controller. The Plans tab itself shows months as expandable cards, each
     one breaking down into its weeks (labeled Past/Current/Upcoming), each
     week breaking down into a corridor picker and day-by-day Gantt chart —
     free windows in gray, allocated blocks in blue, requested-but-unplaced
     blocks in yellow. The Approvals tab shows the same Gantt for any pending
     modification, with the affected day highlighted and a line spelling out
     what changed from what was originally requested.

## Department compatibility

`core.compatibility_matrix` records which department pairs may share one
block window under joint possession by default. `core.compatibility_overrides`
lets the controller override that default for one exact window (a specific
corridor, on a specific day, in a specific block) when that particular block
needs different rules. The optimizer's department-concurrency constraint
checks the override first and falls back to the default.

## Running it

```bash
# Database
docker compose up -d db

# Backend
cd backend
python -m venv .venv && ./.venv/Scripts/activate   # or `source .venv/bin/activate`
pip install -r requirements.txt
python -m scripts.run_pipeline        # loads mapData/, seeds accounts + backlog, trains the model
python main.py                        # runs the API on 127.0.0.1:8000

# Frontend (desktop)
cd ../frontend
npm install
npm run electron:dev
```

`python main.py` is a plain script — no `-m`, no separate `uvicorn` CLI
invocation. The Electron app (`npm run electron:dev`) spawns this same
`python main.py` for you if the backend isn't already running.

Sample inputs for the controller's **Ingest** tab live in `sample_data/` and
can be regenerated against the loaded network:

```bash
python -m scripts.generate_sample_backlogs        # ENGG/SIGNAL/TRD backlog .xlsx (about a third of rows pin a preferred window)
python -m scripts.generate_sample_goods_forecast  # COA goods-train forecast .xlsx for the corridors carrying backlog
```

Backlog workbooks take the optional columns `requested_window_start` /
`requested_window_end` (`YYYY-MM-DD HH:MM`, IST); the goods forecast takes
`corridor_id, forecast_date, band_start, band_end, train_count`. The API
applies `backend/db/schema.sql` on startup (it's all `IF NOT EXISTS`), so a
database created before a table was added catches up without a rebuild.

Login with `engg_dept` / `Engg@2026`, `trd_dept` / `Trd@2026`, `snt_dept` /
`Snt@2026`, or `controller` / `Controller@2026` — change these before any real
deployment (`backend/scripts/seed_users.py`).

## Repo layout

```
mapData/                  stations.json, trains.json, schedules.json (real IR data)
backend/
  db/schema.sql
  app/                    FastAPI: auth, config, db, schemas, routers/
  etl/                    load_network, build_windows, ingest_excel (backlog / timetable / goods forecast), conform_defects, publish
  ml/                     features, ranker training/scoring
  optimizer/              CP-SAT model + plan generation/approval, per-plan availability KPIs (kpis.py)
  app/goods_forecast.py   carves COA forecast bands out of block windows (shared by optimizer, workflow, schedule API)
  workflow/               request lifecycle (submit, reschedule, preemption)
  scripts/                run_pipeline, seed_users, seed_compatibility, retrain_ranker
backend/
  main.py                 standalone entrypoint — `python main.py`
frontend/
  electron/               main.cjs (spawns `python main.py`), preload.cjs
  src/
    lib/mapcss/           MapCSS parser + compiler → MapLibre GL layers
    mapcss/rail-style.mapcss
    pages/                LoginPage, DepartmentDashboard, ControllerDashboard
    components/           NetworkMap, CorridorSchedulePanel, CorridorGantt, CorridorPicker,
                           MonthPlanCard, WeeklyPlanView, BlockCompatibilityEditor,
                           RequestsTable, ModificationList, WeeklySchedule, HistoryPanel
    store/                authStore, appStore (Zustand)
```
