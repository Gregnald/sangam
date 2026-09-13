# Department Dashboard — Complete Feature Guide

## Overview

The Department Dashboard is where **ENGG, SIGNAL, and TRD departments** manage their block requests, track scheduled work, and respond to controller actions. It has **5 tabs** covering the entire request lifecycle.

**Who sees this:** Only logged-in department users. Controller sees a different dashboard.

---

## Navigation Bar (Top of Page)

**5 Tabs:** Requests | My Blocks | Actions Needed | Plan | History

All tabs share a **dark header** with:
- **Light/Dark theme toggle** (top right)
- **Zone selector** (for viewing specific zones)
- **Live updates** every minute (clock sync)

---

## TAB 1: REQUESTS — Submit New Blocks & Browse Backlog

**Purpose:** See all your department's block requests (scheduled, backlog, completed, etc.) and submit new ones.

### Header Section

```
[Your Role] — Block Requests  |  [Zone dropdown with pending count]  |  [+ New Request button]
```

**Example:** `ENGG — Block Requests | Zone ABC (5 pending) | + New Request`

- **Zone selector**: Filters requests by zone. Shows pending count for context.
- **+ New Request button**: Opens the Request Form modal (see below).

### Main Table: All Your Requests

A table showing all your requests with filters and search.

#### Filters (Top of table):

1. **Search box** (left)
   - Search across: corridor ID, asset ID, defect type, plan period
   - Example: Type "rail fracture" → shows only rail fracture requests
   - Live search (instant filtering)

2. **Status dropdown**
   - Filter by: All (default) | Scheduled | Requested | Completed | Cleared | Overdue | etc.
   - Shows counts: "All statuses (28)"

3. **Severity dropdown**
   - Any Severity | A (safety-critical) | B (major) | C (routine)

4. **Zone filter** (if you manage multiple zones)
   - Shows zones with requests in this department

#### Columns in the Table:

| Column | Shows | Example |
|--------|-------|---------|
| **Status Badge** | Color-coded status | 🟨 REQUESTED (yellow) |
| **Corridor** | Track section ID | COR-45 |
| **Defect Type** | What needs fixing | rail_fracture_risk → "rail fracture risk" |
| **Severity** | A/B/C importance | Sev B (amber color) |
| **Block Time** | When scheduled | "Sep 14, 10:00-18:00" (if scheduled) or "—" |
| **Due Date** | Must be done by | "Sep 20, 2026" |
| **Priority Score** | AI-ranked importance | "75/100" (higher = more urgent) |
| **Last Event** | What changed recently | "Placed in Sep weekly plan (5 hours ago)" |
| **Deferred** | How many times rejected | "deferred ×2" (tried 3 times, 2 times rejected) |

#### Status Badges (Color-Coded):

- 🟨 **REQUESTED** (Yellow) — Submitted, in backlog, waiting to be scheduled
- 🟦 **SCHEDULED** (Blue) — Placed in an approved plan, upcoming
- 🟩 **COMPLETED** (Green) — Block window ended, work done
- ⚠️ **OVERDUE** (Red) — Past due date, still unscheduled
- 🔄 **AWAITING_RESPONSE** (Amber) — Controller offered reschedule/bump, waiting for you to answer
- ✓ **CLEARED** (Gray) — Withdrawn by you or controller

#### Click a Row:

**What happens:** Detailed view opens showing:

1. **Request card** (expandable)
   - Full details: Corridor, asset, defect type, severity, priority score
   - Block time or requested window
   - Associated plan (if scheduled)
   - Last event with timestamp and who did it

2. **Day Gantt Chart** (visual timeline for that day)
   - **Blue block** = Your scheduled block (if it exists)
   - **Yellow band** = Window you requested (if not scheduled)
   - **Gray blocks** = Other departments' blocks on same corridor
   - **Red hatched band** = Goods train forecast (blocking slots)
   - **Hover tooltip** = Shows who else is in that block (joint block partners)

---

### REQUEST FORM (Modal Popup)

**Opens when:** You click "+ New Request" button

**A form with these fields:**

#### 1. **Zone → Corridor** (Cascading Dropdown)
- First select a zone (dropdown)
- Then select a corridor in that zone (second dropdown)
- Example: Zone ABC → COR-45

#### 2. **Asset** (Auto-populated)
- Dropdown populated based on selected corridor
- Shows: `Asset Type @ km Marker`
- Example: "Rail Joint @ km 45.5"
- Only shows assets that your department maintains on that corridor

#### 3. **Defect Type** (Department-specific options)

**ENGG options:**
- rail_fracture_risk
- track_geometry_twist
- weld_defect
- ballast_deficiency
- rail_wear

**SIGNAL options:**
- signal_relay_fault
- interlocking_fault
- cable_fault
- track_circuit_failure

**TRD options:**
- insulator_flashover_risk
- feeder_fault
- ohe_wire_wear
- traction_transformer_fault

#### 4. **Severity** (3 buttons)
- **A** (Red) — Safety-critical (e.g., broken rail, failed signal)
- **B** (Amber) — Major (e.g., worn weld, cable damage)
- **C** (Green) — Routine (e.g., maintenance, inspection)

#### 5. **Estimated Duration** (hours)
- Text input: 0.5, 1, 2, 3, 4, 8, 12, etc.
- In decimal: 2.5 hours = 2 hours 30 min
- Used by optimizer to calculate block length

#### 6. **Due Date** (calendar picker)
- When this work MUST be completed by
- Example: "2026-09-20"
- Used to prioritize requests
- Overdue = higher priority, gets bumped up in queue

#### 7. **Preferred Window** (Optional)
- Date picker + time picker (HH:MM, IST)
- If you fill this: System tries to schedule at THIS exact time
- If blank: System schedules anytime that fits
- Example: "2026-09-14 at 10:00" → System plans for Sep 14 starting 10 AM
- Duration auto-calculated: 10:00 + 2.5 hours = 12:30 end time

#### 8. **Special Flags** (Checkboxes)

**☑️ Speed Restriction**
- Check if: Work requires trains to slow down to 20 km/h during block
- Example: Rail repair where trains can creep through at low speed instead of full closure
- Affects plan: If checked, block is scheduled, trains still allowed but slow

**☑️ Trains Cannot Run (Traffic Suspended)**
- Check if: Block requires 100% corridor closure (no trains allowed)
- Example: Signal interlocking work, overhead cable repair, deep track work
- Affects plan: Block shows as "safety-critical", block time protected absolutely, trains diverted

### Form Submission

**Click "Submit Request" button:**

The system:
1. Validates all fields (corridor, asset, defect type, duration, due date)
2. Attempts to **auto-fit** the request into current week's approved plan
3. Returns outcome immediately

#### Possible Outcomes:

**✅ SCHEDULED**
```
"Scheduled directly into this week's plan."
```
- Your request fits in the current approved plan
- No approval needed
- Status immediately becomes "SCHEDULED"
- Department notified, appears in "MY BLOCKS" tab
- You see it in the Gantt chart

**⏳ PENDING** 
```
"Added to the backlog — no capacity found yet this week. 
It will be reconsidered automatically."
```
- Doesn't fit in this week, but may fit later weeks
- Added to BACKLOG (unscheduled queue)
- Priority score calculated
- Status: "REQUESTED"
- Next week when controller generates weekly plan, system tries again
- You check "MY BLOCKS" to track when it gets scheduled

**🔄 RESCHEDULE_OFFERED**
```
"No capacity at the exact time you wanted. 
Check Actions Needed for an alternate window to accept."
```
- Your preferred window is blocked
- BUT: System found a different window on the same corridor that works
- You get notified → see in "ACTIONS NEEDED" tab
- You must ACCEPT or REJECT the alternate window (2-button modal)
- If you accept → Goes to controller for approval
- If you reject → Goes to backlog

**⚠️ PREEMPTION_PENDING**
```
"This request qualifies to bump a lower-priority scheduled block. 
Sent to the controller for approval."
```
- Your request is high-priority AND would fit in a slot held by lower-priority work
- System sends BUMP REQUEST to controller
- You see it in "ACTIONS NEEDED" tab as "Awaiting controller"
- Controller approves/rejects → You get notified in backlog or scheduled

---

## TAB 2: MY BLOCKS — Track Your Scheduled Work

**Purpose:** See all your department's blocks with their current status (upcoming, in progress, completed, needs attention).

### Filter Buttons (Top)

Click to filter which blocks to show:

- **ACTIVE** (count) ← Most common view
  - Scheduled blocks that haven't completed yet
  - Includes: upcoming, in progress, awaiting response

- **All** — Show everything

- **Upcoming** — Will start in the future

- **In progress** — Block window is happening now

- **Scheduled** — In approved plan, upcoming

- **Requested** — In backlog, not scheduled yet

- **Needs my response** — Reschedule/bump offer awaiting your decision

- **Awaiting controller** — Bump/reschedule sent to controller

- **Overdue** — Past due date, still unscheduled (red, urgent)

- **Past** — Completed or cleared

- **Completed** — Block window ended

- **Cleared** — Withdrawn

### Search Box

Search by: corridor, asset, defect type, plan period
- Example: Type "COR" → shows requests on corridors starting with COR

### Block Cards (Main Content)

Each card represents **one of your scheduled blocks.**

#### Collapsed View (Click to expand):

```
🟦 SCHEDULED  #ABC1D  COR-45  rail fracture risk  Sev A
Mon 14 Sep 10:00 – 18:00 IST  (plan Sep 2-8)
─────────────────────────────────────────────
2.5 h | due Sep 20 | priority 75/100 | Joint block (2 depts)
Last event: Placed in Sep weekly plan (2 days ago)
▼ day schedule
```

**Color-coded status badge:**
- 🟨 REQUESTED (yellow)
- 🟦 SCHEDULED (blue)
- 🟩 COMPLETED (green)
- ⚠️ OVERDUE (red)
- 🔄 AWAITING_RESPONSE (amber outline)

**Info line 1:**
- Corridor ID
- Defect type (human-readable)
- Severity (color: red/A, amber/B, green/C)
- Short ID (first 8 chars of UUID)

**Info line 2:**
- Allocated time: "Mon 14 Sep 10:00–18:00 IST"
- Plan period: "(plan Sep 2-8 weekly)"
- If not scheduled: "due Sep 20" or "asked for Sep 14 10:00"

**Info line 3 (gray text):**
- Duration: "2.5 h"
- Due date
- Priority score: "priority 75/100"
- Joint block status: "Joint block (2 depts)" = shared with another department
- Deferred count: "deferred ×1" = tried before, rejected

**Last event:**
- What changed most recently
- Example: "Placed in Sep weekly plan (by controller, 5 hours ago)"

**Expand button:** "▼ day schedule" (click to open details)

#### Expanded View (When You Click):

**1. Waiting For (if applicable):**
```
⚠️ Waiting for: Controller approval for bump
   (Your high-priority request is pending controller's OK)
```

Options shown:
- "Awaiting your response to reschedule offer" (with Accept/Reject buttons)
- "Awaiting controller approval for bump" (in yellow, you can't act)
- "Controller's approval for reschedule" (yellow, waiting)
- "Block window to start" (normal, no action needed)

**2. Last Event Details:**
```
Placed in Sep 2-8 weekly plan by controller (approved 5 hours ago)
```
Shows:
- What: Event type (placed, bumped, offered reschedule, completed, etc.)
- Where: Plan period
- Who: By whom (controller, system, yourself)
- When: Timestamp (5 hours ago, 2 days ago, etc.)

**3. Day Gantt Chart:**
Visual timeline for the day your block is scheduled

```
TIME     │ 08:00 ┼─────────┼─────────┼─────────┼─────────┼─────────┼ 20:00
COR-45   │       │ GOODS   │ (free)  │ ENGG 10h│ S&T 12h │ TRD 5h  │
         │       │ TRAIN   │         └─── JOINT BLOCK ───┘         │
```

- **Your block** (blue): Highlighted with label "This job"
- **Other blocks** (gray): Context
- **Free windows** (white/gray): Empty slots
- **Goods train forecast** (red hatched): Freight path reserved
- **Joint block partners** (stacked lanes): ENGG + S&T together

**Hover on a block** → Tooltip shows: "S&T cable work (2 hrs) · Joint"

---

## TAB 3: ACTIONS NEEDED — Respond to Controller Offers

**Purpose:** See pending decisions YOU must make (accept/reject reschedule, wait for bump approval).

**Shows:** Only modifications awaiting your department's response or controller's decision

### Type 1: RESCHEDULE OFFER (Yellow)

The system couldn't fit your request in your preferred time, but found a different window.

```
┌─ RESCHEDULE OFFER ──────────────────────────────────────────
│ COR-45 · rail fracture risk · Sev A · ENGG (#ABC1D)
│
│ Originally requested: Sep 14, 10:00 – 18:00 IST
│ Proposed instead:    Sep 18, 14:00 – 22:00 IST
│
│ Status: PENDING_DEPT (Your response needed)
│ 
│ [✓ Accept]  [✕ Reject]
└──────────────────────────────────────────────────────────────
```

**What to do:**

- **Accept** → "Yes, I'll take Sep 18 afternoon instead"
  - Request moves to controller for approval (PENDING_CONTROLLER)
  - Controller reviews it, then approves/rejects
  - You get notification of controller's decision
  - If approved: Block scheduled in the new time

- **Reject** → "No, I need my original time, not the alternate"
  - Request returns to BACKLOG
  - Gets higher priority (defer_count++)
  - System will try again next week

**Time Sensitive:**
- If the proposed window's START TIME passes while pending → Offer LAPSES
- You'll be notified: "Offer expired, request returned to backlog"

### Type 2: PRIORITY BUMP REQUEST (Red/Amber)

Your high-priority request can bump a lower-priority block that's already scheduled.

```
┌─ PRIORITY BUMP REQUEST ──────────────────────────────────────
│ COR-45 · rail fracture risk · Sev A · ENGG (#ABC1D)
│
│ Your request qualifies to bump a lower-priority scheduled block:
│ [Currently held by] SIGNAL cable work (Sep 14, 10:00-18:00)
│
│ Status: PENDING_CONTROLLER (Awaiting controller's OK)
│ 
│ [Awaiting Controller]  ← You can't act, controller decides
└──────────────────────────────────────────────────────────────
```

**What happens:**
- Controller reviews → APPROVES:
  - Your job takes the slot
  - SIGNAL's cable work returns to backlog
  - Both departments notified

- Controller reviews → REJECTS:
  - SIGNAL keeps their slot
  - Your request goes to backlog or reschedule offer made

**Time Sensitive:**
- If the block's START TIME passes before controller decides → Bump LAPSES
- You'll be notified: "Target block already ran, request back to backlog"

### Filters

- **Type filter**: Reschedule offers | Bump requests | All types
- **Status filter**: Pending, Lapsed, Accepted, Rejected
- **Department filter** (if multiple depts): Filter by requesting department
- **Search**: Corridor, corridor, defect type, description

---

## TAB 4: PLAN — View Published Plans

**Purpose:** See the controller's approved monthly and weekly plans. This is your "schedule visibility."

### Selectors (Top)

**Zone selector:**
```
Zone: [ABC ▼]
```
- Switch zones to view different regions

**Month selector:**
```
Month: [Sep 2026 ▼]
```
- Options: Current month + any month with a published plan
- Label shows: "Sep 2026 (current)" or "Oct 2026 (upcoming)" or "Aug 2026 (past)"
- Also shows: "— monthly plan" or "— 2 weekly plans only" (if no monthly, just weeklies)

**Weekly plan selector:**
```
Weekly plan: [Week 38: Sep 2-8 ▼]
```
- Lists all approved weekly plans for this zone
- Current week highlighted: "Week 38: Sep 2-8 (current)"
- Upcoming weeks available to preview

### Monthly Plan Card

Shows the entire month broken down by week.

**Visual layout:**
```
September 2026 (CURRENT MONTH)
───────────────────────────────────────────────

Week 1 (Aug 31 – Sep 6)
  [Corridor selector: ABC ▼]
  [Day-by-day Gantt showing: Mon Tue Wed Thu Fri Sat Sun]
  
Week 2 (Sep 7 – Sep 13)
  [Corridor selector: ABC ▼]
  [Day-by-day Gantt]
  
Week 3 (Sep 14 – Sep 20) ← CURRENT WEEK
  [Corridor selector: ABC ▼]
  [Day-by-day Gantt]
```

**What you see:**
- **Corridor selector**: Choose which corridor to view in the Gantt (changes to show that corridor's timeline)
- **Multi-week Gantt**:
  - Blue blocks = Your department's blocks
  - Gray blocks = Other departments
  - Yellow blocks = Still being proposed (not yet approved)
  - Red hatched = Goods train forecast
  - Hover any block → See details: "ENGG rail work (2.5h) · Joint with S&T"

**If no monthly plan exists:**
```
No plan for ABC in Sep 2026 yet — the controller has not generated one for this zone.
```

### Weekly Plan Detail Section

**Shows the selected week in full detail:**

```
Weekly plan — Week 38: Sep 2-8 (CURRENT WEEK)
────────────────────────────────────────────────

[Corridor selector: ABC ▼]

[Full-width Gantt chart showing all 7 days]
Monday    │ [----Block 1----- ] [--Free--] [--Block 2--]
Tuesday   │ [----Block 3--------────────] [Free]
...
Sunday    │ [Free all day]

KPI Panel (right side):
├── Availability: 85% of corridor hours usable
├── Possession hours: 40 hrs vs 12 hrs of actual work (saved 28 hrs by bundling)
├── Block events: 5 blocks (3 shared, 2 single-dept)
├── Your blocks: 2 (8 hours total)
└── Trains affected: 0 (your blocks don't overlap trains)
```

**Interactive:**
- Click a block on the Gantt → Expands to show details
- Hover over free window → Shows "free from Sep 14 10:00–18:00" (if space available)
- Corridor selector → Changes Gantt to show different corridor

**KPI Panel (Availability Metrics):**
- **Availability %**: How much of the corridor was available for trains during the plan
  - Example: 85% = 15% blocked for maintenance
- **Possession hours**: Total hours the corridor was closed
  - Vs. "Actual work hours" = hours jobs took if run separately
  - Bundling saves the difference
- **Block events**: How many maintenance blocks run this week
  - "3 shared" = 3 blocks with multiple departments
  - "2 single" = 2 blocks with one department only
- **Your blocks**: How many of YOUR department's jobs are scheduled
  - "2 blocks, 8 hours total"
- **Trains affected**: How many trains are impacted
  - Should be 0 (system ensures no train overlap)

---

## TAB 5: HISTORY — Audit Trail of All Changes

**Purpose:** See timeline of what happened to each request (submitted → placed → completed).

### Filters

- **Period selector**: [Sep 2026 ▼] — which month/plan to show
- **Horizon type**: Monthly | Weekly | Both
- **Zone filter**: Filter by zone
- **Department filter**: Only your requests, or all departments (if visible)
- **Search**: Corridor, defect type, defect ID, date range

### Event Timeline

Each request shows **all events** from submission to completion:

```
┌─ REQUEST #ABC1D: ENGG rail fracture risk on COR-45 ──────────
│
│ Sep 10, 14:30 by you (ENGG)
│ └─ SUBMITTED: ENGG · rail fracture risk · Sev A · 2.5h due Sep 20
│
│ Sep 10, 14:31 by system
│ └─ PLACED IN PLAN: Added to Sep 2-8 weekly plan for COR-45
│
│ Sep 11, 09:00 by controller
│ └─ PLAN APPROVED: Sep 2-8 weekly plan approved, your block live
│
│ Sep 14, 10:00 by system
│ └─ BLOCK STARTED: Block window started, corridor closed
│
│ Sep 14, 16:30 by system
│ └─ COMPLETED: Block window ended, work marked done
│
└─────────────────────────────────────────────────────────────
```

**Event types you'll see:**
- **SUBMITTED** — You created the request
- **PLACED_IN_PLAN** — System/controller scheduled it
- **PLAN_APPROVED** — Controller approved the plan containing your block
- **OFFERED_RESCHEDULE** — System offered alternate window
- **RESCHEDULE_ACCEPTED** — You accepted alternate window
- **RESCHEDULE_REJECTED** — You rejected alternate window
- **BUMP_REQUESTED** — System sent bump request to controller
- **BUMP_APPROVED** — Controller approved the bump
- **BUMP_LAPSED** — Bump offer expired (window started)
- **BLOCK_STARTED** — Block window started
- **COMPLETED** — Block window ended
- **LAPSED** — Reschedule/bump offer expired
- **RELEASED** — Plan regeneration removed your block
- **CLEARED** — You or controller cancelled the request

**Click an event to expand:**
Shows full details:
- **What**: Event description
- **Who**: Which user or system made the change
- **When**: Timestamp (IST)
- **Why**: Reason (if applicable) — e.g., "Controller rejected: not compatible with other work"

**Search example:**
- Type "COR-45" → Shows all events for requests on corridor 45
- Type "2026-09-14" → Shows all events on that date
- Filter "COMPLETED" → Shows only finished requests

---

## Real-World Example Walkthrough

### Scenario: ENGG Submits a Rail Fracture Request

**Day 1, 2:00 PM:**
1. ENGG logs in → Goes to REQUESTS tab
2. Clicks "+ New Request"
3. Fills form:
   - Zone: ABC, Corridor: COR-45
   - Asset: Rail Joint @ km 45.5
   - Defect: rail_fracture_risk
   - Severity: A (critical)
   - Duration: 2.5 hours
   - Due date: Sep 20
   - Preferred: Sep 14, 10:00 AM
   - Trains cannot run: YES
4. Clicks "Submit"

**Response:** 
```
"No capacity at the exact time you wanted.
Check Actions Needed for an alternate window to accept."
```
Status: RESCHEDULE_OFFERED

**Day 1, 3:00 PM:**
- ENGG checks ACTIONS NEEDED tab
- Sees reschedule offer:
  ```
  COR-45 · rail_fracture_risk · Sev A
  Requested: Sep 14, 10:00-12:30
  Offered: Sep 18, 14:00-16:30
  [✓ Accept] [✕ Reject]
  ```
- ENGG clicks "Accept"
- Status: PENDING_CONTROLLER

**Day 2, 9:00 AM:**
- Controller approves the reschedule
- ENGG notified: "Your reschedule for Sep 18 approved"

**Day 2, 9:30 AM:**
- ENGG checks MY BLOCKS tab
- Sees block:
  ```
  🟦 SCHEDULED #ABC1D COR-45 rail fracture risk Sev A
  Wed 18 Sep 14:00 – 16:30 IST (plan Sep 16-22)
  2.5 h | due Sep 20 | priority 75/100
  Last event: Placed in Sep 16-22 weekly plan
  ```

**Day 2, 4:00 PM:**
- ENGG checks PLAN tab
- Selects: Zone ABC, Sep 2026, Week 39 (Sep 16-22)
- Sees their block on COR-45 Wed Sep 18, 14:00-16:30

**Sep 18, 14:00:**
- Block starts, corridor closes
- System auto-marks status: IN_PROGRESS
- MY BLOCKS shows: 🟦 "This block is running now"

**Sep 18, 16:30:**
- Clock job marks: COMPLETED
- MY BLOCKS moves to Completed section (green badge)
- HISTORY shows: COMPLETED event

**Sep 21:**
- ENGG reviews HISTORY tab
- Clicks the request → Sees full timeline:
  - Sep 10: SUBMITTED
  - Sep 10: PLACED_IN_PLAN
  - Sep 11: PLAN_APPROVED
  - Sep 18: BLOCK_STARTED
  - Sep 18: COMPLETED

---

## Key Tips for Department Users

### 1. **Check Actions Needed Weekly**
- Reschedule offers expire if you don't respond before the window starts
- If expired → Your request goes back to backlog

### 2. **Set Realistic Due Dates**
- Overdue requests get higher priority
- But if unrealistic, system can't place it on time → stays in backlog

### 3. **Use Preferred Window Only If Needed**
- If you're flexible → Leave blank, system optimizes better
- If you MUST work on specific date → Fill preferred window
- Controllers appreciate flexibility (easier to bundle jobs)

### 4. **Monitor Last Event**
- Check what the last change was (placed, bumped, lapsed, completed)
- If "lapsed" → Your offer expired, try again next week

### 5. **Request Form Tips**
- **Severity**: Only pick A if truly safety-critical (affects bundling)
- **Duration**: Estimate conservatively (longer = more likely to fit)
- **Traffic Suspended**: Only check if trains CANNOT run (most impacts schedule)
- **Speed Restriction**: Use if trains can creep through at 20 km/h (more flexible)

### 6. **Joint Block = Good**
- "Joint block (2 depts)" = Your job runs WITH another department
- Saves possession hours, less downtime overall
- More likely to fit in schedule

### 7. **Deferred Count Rising**
- "deferred ×3" = Tried 4 times, rejected 3 times
- System auto-increases its priority each cycle
- Won't starve forever, will eventually get scheduled

---

## Status Flow Diagram

```
SUBMIT REQUEST (Requests tab)
        ↓
        └──→ Auto-fit attempt
             ├─→ FITS IMMEDIATELY
             │   └──→ 🟦 SCHEDULED (appears in My Blocks)
             │
             ├─→ Can BUMP lower-priority block
             │   └──→ ⚠️ PREEMPTION_PENDING (in Actions Needed)
             │        ├─→ Controller approves
             │        │   └──→ 🟦 SCHEDULED
             │        └─→ Controller rejects
             │            └──→ 🟨 REQUESTED (back to backlog)
             │
             ├─→ Different window works on same corridor
             │   └──→ 🔄 RESCHEDULE_OFFERED (in Actions Needed)
             │        ├─→ You ACCEPT
             │        │   └──→ PENDING_CONTROLLER (yellow, waiting)
             │        │        ├─→ Controller approves
             │        │        │   └──→ 🟦 SCHEDULED
             │        │        └─→ Controller rejects
             │        │            └──→ 🟨 REQUESTED
             │        │
             │        └─→ You REJECT
             │            └──→ 🟨 REQUESTED (back to backlog)
             │
             └──→ NOTHING FITS
                 └──→ 🟨 REQUESTED (backlog, defer_count++)

ONCE SCHEDULED:
        🟦 SCHEDULED → 🟪 (upcoming/about to start)
                     → 🔵 (in progress now)
                     → 🟩 COMPLETED (done)
                     → 🕐 HISTORY (archived)
```

---

## Keyboard Shortcuts (If Implemented)

- `Ctrl+K` / `Cmd+K`: Quick search across all tabs
- `Ctrl+N`: New request (if on Requests tab)
- `Esc`: Close modal/expanded view
- Tab navigation: Between tabs at top

---

## Notifications

Department users get **real-time push notifications** for:
1. ✅ "Your request was scheduled in the approved plan"
2. ⚠️ "Reschedule offer for your request — please respond"
3. ✅ "Your reschedule offer was approved"
4. ❌ "Your reschedule offer was rejected"
5. ⚠️ "Bump request pending controller approval"
6. ✅ "Your bump request was approved, block is scheduled"
7. 🔄 "Your block is being bumped by higher-priority request"
8. ✅ "Your block completed successfully"
9. ⏰ "Reschedule offer will expire in 1 hour — respond now"

Notifications appear as:
- **Toast** (bottom right, auto-dismiss)
- **Bell icon** (top bar, clickable)
- **Tab highlight** if important action needed (Actions Needed tab highlighted)

---

## Common Issues & Solutions

| Problem | Solution |
|---------|----------|
| Request stuck in backlog | Check if due date is realistic; defer_count rising means try again next week |
| Reschedule offer missing | Check ACTIONS NEEDED tab, or it may have lapsed (offer expired) |
| Block shows wrong time | Timezone: APP shows IST (Asia/Kolkata), verify it matches |
| Can't accept reschedule | Window may have started already (lapsed); check timestamp |
| Old plan showing in Plan tab | Switch zones or periods; cleared plans don't show |
| No blocks in My Blocks | Check filter (set to "ACTIVE"); or no scheduled requests this week |

