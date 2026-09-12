CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS plan;

-- =========================================================================
-- RAW — per-department request landing tables
-- =========================================================================

CREATE TABLE IF NOT EXISTS raw.defects_tms (
    defect_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload         JSONB NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS raw.defects_smms (
    defect_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload         JSONB NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS raw.defects_tdms (
    defect_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload         JSONB NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================================================================
-- CORE — network, users, backlog
-- =========================================================================

CREATE TABLE IF NOT EXISTS core.users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.stations (
    station_id      TEXT PRIMARY KEY,
    code            TEXT UNIQUE,
    name            TEXT NOT NULL,
    state           TEXT,
    zone            TEXT,
    geom            GEOMETRY(Point, 4326)
);
CREATE INDEX IF NOT EXISTS idx_stations_geom ON core.stations USING GIST (geom);

CREATE TABLE IF NOT EXISTS core.corridors (
    corridor_id     TEXT PRIMARY KEY,
    station_a_code  TEXT NOT NULL,
    station_b_code  TEXT NOT NULL,
    direction       TEXT NOT NULL DEFAULT 'up',
    line_name       TEXT NOT NULL,
    zone            TEXT,
    length_km       NUMERIC(8,3),
    train_count     INT NOT NULL DEFAULT 0,
    geom            GEOMETRY(LineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corridors_geom ON core.corridors USING GIST (geom);

CREATE TABLE IF NOT EXISTS core.corridor_traversals (
    traversal_id    BIGSERIAL PRIMARY KEY,
    corridor_id     TEXT REFERENCES core.corridors(corridor_id),
    train_number    TEXT NOT NULL,
    train_name      TEXT,
    direction       TEXT NOT NULL,
    depart_min      INT NOT NULL,
    arrive_min      INT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traversals_corridor ON core.corridor_traversals (corridor_id);

CREATE TABLE IF NOT EXISTS core.assets (
    asset_id        TEXT PRIMARY KEY,
    corridor_id     TEXT REFERENCES core.corridors(corridor_id),
    asset_type      TEXT NOT NULL,
    department      TEXT NOT NULL,
    km_marker       NUMERIC(8,3),
    geom            GEOMETRY(Point, 4326)
);
CREATE INDEX IF NOT EXISTS idx_assets_corridor ON core.assets (corridor_id);

CREATE TABLE IF NOT EXISTS core.compatibility_matrix (
    dept_a          TEXT NOT NULL,
    dept_b          TEXT NOT NULL,
    compatible      BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT,
    PRIMARY KEY (dept_a, dept_b)
);

CREATE TABLE IF NOT EXISTS core.corridor_block_windows (
    window_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corridor_id             TEXT REFERENCES core.corridors(corridor_id),
    window_start            TIMESTAMPTZ NOT NULL,
    window_end              TIMESTAMPTZ NOT NULL,
    max_concurrent_depts    SMALLINT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_windows_corridor_time ON core.corridor_block_windows (corridor_id, window_start);

-- Per-block compatibility exceptions: a specific window on a specific day can
-- override the department-pair default (core.compatibility_matrix) — e.g. a
-- block that involves heavy machinery on one part of the corridor that
-- normally-compatible departments still can't safely share that particular day.
CREATE TABLE IF NOT EXISTS core.compatibility_overrides (
    override_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    window_id       UUID NOT NULL REFERENCES core.corridor_block_windows(window_id) ON DELETE CASCADE,
    dept_a          TEXT NOT NULL,
    dept_b          TEXT NOT NULL,
    compatible      BOOLEAN NOT NULL,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (window_id, dept_a, dept_b)
);
CREATE INDEX IF NOT EXISTS idx_compat_override_window ON core.compatibility_overrides (window_id);

CREATE TABLE IF NOT EXISTS core.defects (
    defect_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system           TEXT NOT NULL,
    asset_id                TEXT REFERENCES core.assets(asset_id),
    corridor_id             TEXT REFERENCES core.corridors(corridor_id),
    defect_type              TEXT NOT NULL,
    severity_code            CHAR(1) NOT NULL,
    department               TEXT NOT NULL,
    detected_date            DATE NOT NULL,
    due_date                 DATE NOT NULL,
    last_inspection_date     DATE,
    speed_restriction_kmph   INT,
    estimated_block_hours    NUMERIC(5,2) NOT NULL,
    requested_window_start   TIMESTAMPTZ,
    requested_window_end     TIMESTAMPTZ,
    requested_by             TEXT,
    defer_count              INT NOT NULL DEFAULT 0,
    workflow_status           TEXT NOT NULL DEFAULT 'pending',
    priority_score            NUMERIC(5,2),
    priority_explanation      JSONB,
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_defects_status_sev ON core.defects (workflow_status, severity_code);
CREATE INDEX IF NOT EXISTS idx_defects_corridor ON core.defects (corridor_id);
CREATE INDEX IF NOT EXISTS idx_defects_department ON core.defects (department);

-- =========================================================================
-- PLAN — schedules, modification workflow, notifications, history
-- =========================================================================

CREATE TABLE IF NOT EXISTS plan.block_plans (
    plan_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    horizon_type    TEXT NOT NULL,
    period_label    TEXT NOT NULL,
    horizon_start   DATE NOT NULL,
    horizon_end     DATE NOT NULL,
    zone            TEXT,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          TEXT NOT NULL DEFAULT 'pending_approval',
    solver_status   TEXT,
    objective_value NUMERIC,
    solve_seconds   NUMERIC,
    approved_by     TEXT,
    approved_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS plan.block_assignments (
    assignment_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id             UUID REFERENCES plan.block_plans(plan_id) ON DELETE CASCADE,
    window_id           UUID REFERENCES core.corridor_block_windows(window_id),
    corridor_id         TEXT REFERENCES core.corridors(corridor_id),
    defect_id           UUID REFERENCES core.defects(defect_id),
    department          TEXT NOT NULL,
    allocated_start      TIMESTAMPTZ NOT NULL,
    allocated_end        TIMESTAMPTZ NOT NULL,
    joint_block_group_id UUID
);
CREATE INDEX IF NOT EXISTS idx_assignments_plan ON plan.block_assignments (plan_id);
CREATE INDEX IF NOT EXISTS idx_assignments_defect ON plan.block_assignments (defect_id);
CREATE INDEX IF NOT EXISTS idx_assignments_corridor_time ON plan.block_assignments (corridor_id, allocated_start);

CREATE TABLE IF NOT EXISTS plan.modification_requests (
    request_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_type            TEXT NOT NULL,
    defect_id               UUID REFERENCES core.defects(defect_id),
    requesting_department   TEXT NOT NULL,
    target_plan_id          UUID REFERENCES plan.block_plans(plan_id),
    affected_defect_id      UUID REFERENCES core.defects(defect_id),
    affected_department     TEXT,
    proposed_corridor_id    TEXT,
    proposed_window_start   TIMESTAMPTZ,
    proposed_window_end     TIMESTAMPTZ,
    description              TEXT NOT NULL,
    status                   TEXT NOT NULL DEFAULT 'pending_dept',
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at               TIMESTAMPTZ,
    decided_by               TEXT,
    decision_reason          TEXT
);
CREATE INDEX IF NOT EXISTS idx_modreq_status ON plan.modification_requests (status);
CREATE INDEX IF NOT EXISTS idx_modreq_dept ON plan.modification_requests (requesting_department);

CREATE TABLE IF NOT EXISTS plan.notifications (
    notification_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_role       TEXT NOT NULL,
    message              TEXT NOT NULL,
    related_request_id   UUID REFERENCES plan.modification_requests(request_id),
    is_read              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON plan.notifications (recipient_role, is_read);

CREATE TABLE IF NOT EXISTS plan.plan_history (
    history_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id         UUID REFERENCES plan.block_plans(plan_id),
    horizon_type    TEXT NOT NULL,
    period_label    TEXT NOT NULL,
    snapshot_type   TEXT NOT NULL,
    snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload         JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_history_period ON plan.plan_history (period_label, horizon_type);

CREATE TABLE IF NOT EXISTS plan.pipeline_runs (
    run_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running',
    stage           TEXT,
    log             TEXT
);

CREATE TABLE IF NOT EXISTS plan.model_versions (
    version_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trained_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    artifact_path   TEXT NOT NULL,
    metrics         JSONB,
    promoted        BOOLEAN NOT NULL DEFAULT FALSE
);

-- =========================================================================
-- Goods-train forecast from the Control Office (COA)
-- =========================================================================
-- Freight paths are not in the passenger timetable, so the corridor window
-- calendar (built from timetabled traversals only) would otherwise offer a
-- block over a slot the Control Office expects to run goods trains through.
-- Each row says: on this corridor, on this date, between these minutes of
-- the day, expect N goods trains — the block planner treats that band as
-- occupied and clips any candidate window that overlaps it.

CREATE TABLE IF NOT EXISTS core.goods_train_forecasts (
    forecast_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    corridor_id     TEXT NOT NULL REFERENCES core.corridors(corridor_id),
    forecast_date   DATE NOT NULL,
    band_start_min  SMALLINT NOT NULL CHECK (band_start_min BETWEEN 0 AND 1439),
    band_end_min    SMALLINT NOT NULL CHECK (band_end_min BETWEEN 1 AND 1440 AND band_end_min > band_start_min),
    train_count     SMALLINT NOT NULL DEFAULT 1,
    source          TEXT NOT NULL DEFAULT 'COA',
    uploaded_by     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (corridor_id, forecast_date, band_start_min, band_end_min)
);
CREATE INDEX IF NOT EXISTS idx_goods_forecast_corridor_date ON core.goods_train_forecasts (corridor_id, forecast_date);

-- =========================================================================
-- Backlog event log — every status transition a request goes through
-- =========================================================================
-- core.defects only carries the *current* workflow_status; this is the
-- trail behind it: submitted / ingested, scheduled by which plan, reschedule
-- offered / accepted / rejected, bumped, released by a superseding plan,
-- completed by the clock, lapsed offers, cleared. Feeds the Backlog history
-- tab and each request's "last event" line.

CREATE TABLE IF NOT EXISTS core.defect_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    defect_id       UUID NOT NULL REFERENCES core.defects(defect_id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    from_status     TEXT,
    to_status       TEXT,
    actor           TEXT,
    details         TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_defect_events_defect ON core.defect_events (defect_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_defect_events_time ON core.defect_events (occurred_at DESC);

-- =========================================================================
-- Job-level compatibility: work type × work type, and the decision log the
-- pairwise model learns from
-- =========================================================================
-- Whether two *jobs* can share one possession is a single matrix over kinds
-- of work (each kind belongs to one department, so department compatibility
-- is implied): tamping never alongside a track-circuit job, no hot welding
-- under contact-wire renewal, relay-room work alongside anything. The
-- controller edits it from the Compatibility tab; every edit is logged as a
-- decision and retrains the pairwise model.

CREATE TABLE IF NOT EXISTS core.work_type_compatibility (
    type_a              TEXT NOT NULL,
    type_b              TEXT NOT NULL,
    compatible          BOOLEAN NOT NULL,
    notes               TEXT,
    updated_by          TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (type_a, type_b)
);

-- Every time the controller decides whether two kinds of work may share a
-- possession (a matrix edit, a per-window override), the decision is logged
-- with the pair's features. This is the training set for the pairwise
-- compatibility model (ml/pair_compat_model.py).
CREATE TABLE IF NOT EXISTS core.pair_decisions (
    decision_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by      TEXT,
    source          TEXT NOT NULL,                -- 'matrix' | 'override'
    dept_a          TEXT NOT NULL,
    dept_b          TEXT NOT NULL,
    type_a          TEXT,
    type_b          TEXT,
    duration_a_h    NUMERIC(5,2),
    duration_b_h    NUMERIC(5,2),
    traffic_factor  NUMERIC(4,3),
    corridor_id     TEXT,
    window_id       UUID,
    compatible      BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pair_decisions_time ON core.pair_decisions (decided_at DESC);
