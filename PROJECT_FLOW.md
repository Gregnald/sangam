# SANGAM - Railway Block Planning & Coordination System

## What Is SANGAM?

A **full-stack web + desktop application** that coordinates maintenance block requests (planned closures) across 3 railway departments:
- **ENGG** (Engineering - track work)
- **S&T** (Signal & Telecom)
- **TRD** (Traction Distribution - electrical)

Instead of each department requesting blocks independently via spreadsheets, SANGAM:
- Intelligently **bundles jobs into shared "joint blocks"** (save closures)
- Uses **XGBoost AI** to prioritize requests
- Uses **Google OR-Tools optimizer** to solve block assignments
- Requires **controller approval** for plans and high-priority exceptions
- Provides **real-time live updates** as status changes

---

## Core System Flow

### 1. REQUEST SUBMISSION (Department)

Department submits a maintenance request with:
- **Corridor** (track section)
- **Defect type** (track defect, signal failure, cable damage, etc.)
- **Severity** (A/B/C/D - where A is critical)
- **Duration** (how long they need the block)
- **Due date** (when it should be done)
- **Preferred window** (optional - they may pick a specific time slot)

**Status**: Goes to **BACKLOG** (unscheduled requests queue)

---

### 2. SYSTEM TRIES TO FIT REQUEST (Auto-scheduling)

When a new request arrives (or during weekly plan generation), system checks:

#### **Option A: Fits in Current Week's Approved Plan ✓**
→ **Immediately scheduled** (no approval needed)
→ Status: **SCHEDULED**
→ Department notified

#### **Option B: Doesn't fit, BUT can bump lower-priority job** 
→ Creates **BUMP REQUEST** 
→ Goes to **Controller** (approval tab shows this)
→ If Controller **Approves**:
  - New high-priority job gets scheduled
  - Old low-priority job returns to **BACKLOG**
  - Both departments notified
→ If **Rejected**:
  - Request stays in backlog

#### **Option C: Doesn't fit THIS window, BUT different window works on same corridor**
→ System offers **RESCHEDULE** (alternate time slot)
→ Department must **Accept or Reject**
→ If **Accept**: 
  - Sends to **Controller** (approval tab)
  - Controller can approve/reject it
→ If **Reject**:
  - Request goes back to **BACKLOG**

#### **Option D: Nothing fits anywhere this week**
→ Request stays in **BACKLOG**
→ Gets `defer_count++` (increases priority each cycle)
→ Status: **BACKLOG** (waiting)

---

### 3. INTELLIGENT BUNDLING - "Joint Blocks"

**Normal system**: 1 job = 1 maintenance block (closure) = downtime

**SANGAM approach**: Multiple jobs share one block if compatible

```
Example:
─────────────────────────────────
ENGG crew repairs track |  8 hours
S&T crew fixes signals  | 12 hours (works in parallel)
TRD checks cables       |  5 hours (works in parallel)
─────────────────────────────────
Result: 1 block, 12 hours (max of all three)
Instead of: 3 blocks, 25 hours total downtime

Savings = 13 hours of possession time!
```

**Rules for sharing:**
1. **Different departments = PARALLEL** (simultaneous work)
2. **Same department = SEQUENTIAL** (one after another)
3. **Compatibility Matrix** decides which pairs can mix:
   - **Default**: ENGG ↔ SIGNAL always OK
   - **Default**: TRD only if controller manually approves
   - Can override per-block (e.g., "Allow TRD on THIS corridor TODAY")
4. **Learned compatibility**: Model trains on controller's 5+ approval decisions
   - Can suggest new defaults based on patterns

**Objective function** (what optimizer minimizes):
- **Possession hours** (longer possession = costs more)
- **Weighted by corridor traffic** (trunk line = 2x cost vs quiet branch)
- **Fixed cost per block event**
- **Lateness penalty** (if due date passed)

Optimizer bundles jobs to minimize these costs.

---

## Monthly/Weekly Planning Cycle

### **Monthly Plan Generation** (Controller-triggered)

1. Controller: "Generate Monthly Plan" for Sept 2026, Zone XYZ
2. System:
   - Reads all **unscheduled requests** in backlog
   - Solves with optimizer: which jobs → which blocks → which corridors
   - Creates **proposed monthly plan**
   - **No changes to database yet**
3. Controller: Reviews Gantt chart + KPIs
   - **Gantt shows**: Blue blocks (scheduled), Yellow (pending), Gray (free windows)
   - **KPIs show**: Availability % of corridors, possession hours, shared blocks, saved hours
4. Controller: **APPROVES** or **REJECTS**
   - **Approve** → Plan goes **LIVE**
     - Week 1 of month auto-generates + auto-approves (derived from approved monthly)
     - All requests in plan move to **SCHEDULED**
     - Departments notified
     - Unplaced requests stay in **BACKLOG** with `defer_count++`
   - **Reject** → Plan discarded, nothing changes

### **Weekly Plan Generation**

1. Each week start: Controller clicks "Generate Next Weekly Plan" for Week 2, 3, etc.
2. System:
   - Solves remaining jobs for that week
   - Builds on approved weekly plans already in place
3. Controller reviews + approves same as above

### **Regenerate Current Month**

- Weeks with approved plans → **FROZEN** (don't change)
- Past days → **FROZEN**
- Everything else → **RE-OPTIMIZED**
- Unplaced jobs → Back to **BACKLOG**

---

## Snapshot of Dashboard Tabs

Based on your screenshot:

| Tab | Who Uses | What It Shows | What Can Do |
|-----|----------|---------------|------------|
| **Backlog** | Both | All unscheduled requests | Dept: see their requests. Controller: approve offers, see all |
| **Approvals** | Controller | Pending plans/modifications | Approve/Reject plans, bumps, reschedules. See what changed |
| **Plans** | Both | All approved monthly/weekly plans | Browse by month/week/zone. View Gantt + KPIs. Filter by dept |
| **Analytics** | Both | Charts: request trends, completion rates, dept workload | Analyze system health, bump frequency, shared block savings |
| **Compatibility** | Controller | Work-type compatibility grid (which jobs can share) | Edit matrix cells (red/green). See learned model suggestions |
| **Ingest** | Controller | Upload Excel files | Bulk import backlog, new timetables, freight forecasts |
| **History** | Both | All past plans (versions), all request events (timeline) | Browse old plans, see when each request was placed/completed |

---

## The Real-Time Clock

**Every minute**, a background job runs (`workflow/clock.py`):

1. **Mark completed blocks**: If a block's closure window ended → Status: **COMPLETED**
2. **Mark lapsed offers**: If reschedule/bump window already started → Offer expires, request → **BACKLOG**
3. **Flag overdue**: If due date passed, still in backlog → Status: **OVERDUE**
4. **Record all changes** to `core.defect_events` (history table)

Request lifecycle visible in real-time:
- **SUBMITTED** → in backlog
- **SCHEDULED** → in approved plan
- **IN_PROGRESS** → block window is now
- **COMPLETED** → block window ended
- **OVERDUE** → past due date, still waiting
- **NEEDS_RESPONSE** → offer awaiting department answer

---

## Data Flow Diagram

```
MAP DATA (Real)
├── stations.json        (railway stations)
├── trains.json          (passenger timetables)
├── schedules.json       (version 1 effective date)
└── Derives: corridors, block windows (free slots)

        ↓

BACKLOG (Unscheduled Requests)
├── ENGG: 25 requests
├── S&T: 18 requests
└── TRD: 12 requests

        ↓

[SUBMISSION FLOW]
Department submits → Auto-fit attempt (A/B/C/D options) → Status changes

        ↓

[PLANNING FLOW - Weekly/Monthly]
Controller: "Generate Plan" 
    → Solver reads: backlog + approved blocks + goods forecast
    → Runs optimizer (CP-SAT)
    → Creates proposed plan
    → Controller APPROVES
    → Plan goes LIVE

        ↓

APPROVED PLANS (Live)
├── September Monthly Plan
│   ├── Week 1 (auto-derived)
│   ├── Week 2 (regenerated weekly)
│   └── Week 3 (regenerated weekly)
└── Each shows: Gantt + KPIs + dept breakdown

        ↓

REQUESTS STATUS (Updated every minute by clock)
├── My Blocks (dept view): shows upcoming/in-progress/completed
└── History (all): events timeline

        ↓

ANALYTICS (Trends)
├── Completion rates
├── Bump/reschedule frequency
├── Avg deferral count
└── Shared block savings
```

---

## Key AI Components

### 1. Priority Model (XGBoost)
- **Inputs**: request age, defer_count, severity, corridor traffic, due-date distance
- **Output**: Priority score (0-100)
- **Uses**: Decides which job can bump another
- **Retrains**: When seed data loaded, then manually by controller

### 2. Optimizer (Google OR-Tools CP-SAT)
- **Inputs**: backlog, corridors, block windows, compatibility matrix, goods forecast
- **Output**: Block assignments (job A+job B+job C → block on corridor X, date Y)
- **Constraints**:
  - Respects compatibility matrix (pairwise)
  - Respects goods train forecasts (no conflict)
  - Same-dept jobs sequence
  - Different-dept jobs parallel if compatible
- **Objective**: Minimize possession hours (weighted by traffic) + block events + lateness

### 3. Compatibility Learning (Gradient Boosted Classifier)
- **Trains on**: Every controller override decision
- **Outputs**: Soft preference in optimizer (not hard constraint)
- **Threshold**: After 5+ observations on a pair, suggests new default (Beta posterior)
- **Evolution**: Matrix starts from seed, learns from real controller behavior

---

## Technology Stack

### **Backend** (Python)
```
FastAPI          → REST API + Server-Sent Events (live updates)
PostgreSQL       → Data persistence
APScheduler      → Clock job (every minute)
XGBoost          → Priority model
OR-Tools CP-SAT  → Block optimizer
SHAP             → Explainability (why is this request scored X?)
Pydantic         → Data validation
```

### **Frontend** (React/TypeScript)
```
React            → UI components
Zustand          → State management (requests, plans, auth)
Tailwind CSS     → Styling + light/dark theme
TanStack Table   → Data grids (backlog, requests)
Recharts         → Analytics charts
Vite             → Build tool + dev server
Electron         → Desktop app (macOS/Windows/Linux)
EventSource      → Live updates (SSE from backend)
```

### **Database** (Postgres)
```
core.users                        → Login accounts
core.corridors, core.stations     → Network topology
core.timetable_versions           → Train schedules (versioned)
core.active_block_windows         → Free slot candidates
core.defects                       → Requests/backlog
core.defect_events                → History (submitted/placed/completed/etc)
core.plans                         → Plan snapshots (as-proposed, as-approved)
core.block_assignments            → What job is in which block
core.compatibility_matrix         → Dept pair compatibility (default)
core.compatibility_overrides      → Per-block exceptions
core.goods_train_forecasts        → Freight path reservations
ml.priority_scores                → Model outputs + explanations
```

---

## System Users & Access

### **Department Users** (ENGG, S&T, TRD)
- **Login**: engg_dept / Engg@2026 (etc)
- **Can**:
  - Submit new requests
  - Accept/reject reschedule offers
  - View their approved blocks ("My Blocks")
  - View history of their requests
  - View plan overview
- **Cannot**: Approve plans, see other depts' requests, edit compatibility

### **Controller User**
- **Login**: controller / Controller@2026
- **Can**:
  - Generate/approve/reject monthly and weekly plans
  - Approve/reject bump requests
  - Approve/reject reschedule acceptances
  - Edit compatibility matrix
  - Override compatibility per-block
  - Ingest new data (backlog, timetables, freight forecast)
  - Reset entire system
  - View analytics
  - View all requests from all depts
  - View full history

---

## What You Need to Do (From Modified Files)

Your git status shows changes across:
- **Backend**: main.py, routers (analytics, corridors, requests), schema, ETL, ML, optimizer, workflow
- **Frontend**: Components, pages, stores, types

### Immediate Tasks (from the recent changes):
1. ✅ **Fix CORS/tunnel** (we just did this - vite config + API_BASE)
2. **Complete analytics implementation** - charts/types/backend endpoints
3. **Verify request workflow** - submit → auto-fit → approval flow
4. **Test compatibility matrix** - edit, learn, apply to optimizer
5. **Test full plan generation** - monthly → weekly → approval → live
6. **Test clock sync** - requests change status every minute
7. **Test live updates** - EventSource pushes changes to all open pages
8. **Production setup**:
   - Real database (not dev SQLite)
   - Real train data (not seed data)
   - Real backlog (migrate from TMS/SMMS/TDMS)
   - Train priority model on historical data
   - Deploy with Docker
9. **Security** - Change default passwords before production

---

## Running It Locally

```bash
# Terminal 1: Database
docker compose up -d db

# Terminal 2: Backend
cd backend
python -m venv .venv
source .venv/bin/activate  # or `.venv\Scripts\activate` on Windows
pip install -r requirements.txt
python -m scripts.run_pipeline  # Seed data, train model
python main.py                  # Starts on http://127.0.0.1:8000

# Terminal 3: Frontend (Electron desktop app)
cd frontend
npm install
npm run electron:dev           # Opens dev app, spawns backend if not running

# OR just web browser:
cd frontend
npm run dev                    # Vite on http://localhost:5173
# Open http://localhost:5173 in browser
```

---

## Next Steps to Show Progress

1. **Start backend**: `python main.py`
2. **Start frontend**: `npm run electron:dev`
3. **Log in** as `controller` / `Controller@2026`
4. **Go to Backlog tab** → See sample requests
5. **Go to Plans tab** → Try "Generate Monthly Plan"
6. **Review the proposed plan** in Gantt
7. **Click Approve** → See live changes
8. **Go to Analytics** → See charts
9. **Go to Compatibility** → See the work-type matrix

This gives you the full system end-to-end! 🚀
