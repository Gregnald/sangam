from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

CamelModel = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class LoginRequest(BaseModel):
    model_config = CamelModel
    username: str
    password: str


class LoginResponse(BaseModel):
    model_config = CamelModel
    token: str
    username: str
    role: str
    display_name: str


class Corridor(BaseModel):
    model_config = CamelModel
    corridor_id: str
    station_a_code: str
    station_b_code: str
    direction: str
    line_name: str
    zone: str | None = None
    length_km: float | None = None
    train_count: int


class PriorityFactor(BaseModel):
    model_config = CamelModel
    factor: str
    score: float


class DefectRequest(BaseModel):
    model_config = CamelModel
    defect_id: uuid.UUID
    source_system: str
    asset_id: str | None = None
    corridor_id: str | None = None
    zone: str | None = None
    defect_type: str
    severity_code: str
    department: str
    detected_date: date
    due_date: date
    speed_restriction_kmph: int | None = None
    estimated_block_hours: float
    requested_window_start: datetime | None = None
    requested_window_end: datetime | None = None
    requested_by: str | None = None
    defer_count: int
    workflow_status: str
    priority_score: float | None = None
    priority_explanation: list[PriorityFactor] | None = None
    updated_at: datetime | None = None
    # Live block (from an approved plan), if the request is scheduled.
    allocated_start: datetime | None = None
    allocated_end: datetime | None = None
    plan_id: uuid.UUID | None = None
    plan_period_label: str | None = None
    joint_block_group_id: uuid.UUID | None = None
    # Everyone sharing that possession (incl. this department) and how many jobs it holds.
    group_departments: list[str] | None = None
    group_size: int | None = None
    # Derived from the clock: pending past its due date; scheduled block
    # upcoming / in progress / completed.
    is_overdue: bool = False
    execution_state: Literal["upcoming", "in_progress", "completed"] | None = None
    last_event_type: str | None = None
    last_event_at: datetime | None = None
    last_event_details: str | None = None
    last_event_actor: str | None = None


class DefectEvent(BaseModel):
    model_config = CamelModel
    event_id: uuid.UUID
    defect_id: uuid.UUID
    event_type: str
    from_status: str | None = None
    to_status: str | None = None
    actor: str | None = None
    details: str | None = None
    occurred_at: datetime
    department: str
    corridor_id: str | None = None
    zone: str | None = None
    defect_type: str
    severity_code: str


class ModelVersion(BaseModel):
    model_config = CamelModel
    version_id: uuid.UUID
    trained_at: datetime
    artifact_path: str
    metrics: dict[str, Any] | None = None
    promoted: bool


class SubmitRequestBody(BaseModel):
    model_config = CamelModel
    corridor_id: str
    asset_id: str
    defect_type: str
    severity_code: Literal["A", "B", "C"]
    estimated_block_hours: float
    due_date: date
    requested_window_start: datetime | None = None
    requested_window_end: datetime | None = None
    speed_restriction_kmph: int | None = None


class SubmitRequestResponse(BaseModel):
    model_config = CamelModel
    defect_id: uuid.UUID
    outcome: str


class BlockAssignment(BaseModel):
    model_config = CamelModel
    assignment_id: uuid.UUID
    plan_id: uuid.UUID
    window_id: uuid.UUID | None = None
    corridor_id: str | None = None
    defect_id: uuid.UUID | None = None
    department: str
    allocated_start: datetime
    allocated_end: datetime
    joint_block_group_id: uuid.UUID | None = None


class BlockPlan(BaseModel):
    model_config = CamelModel
    plan_id: uuid.UUID
    horizon_type: str
    period_label: str
    horizon_start: date
    horizon_end: date
    zone: str | None = None
    generated_at: datetime
    status: str
    solver_status: str | None = None
    objective_value: float | None = None
    solve_seconds: float | None = None
    approved_by: str | None = None
    approved_at: datetime | None = None


class ModificationRequest(BaseModel):
    model_config = CamelModel
    request_id: uuid.UUID
    request_type: str
    defect_id: uuid.UUID | None = None
    requesting_department: str
    target_plan_id: uuid.UUID | None = None
    affected_defect_id: uuid.UUID | None = None
    affected_department: str | None = None
    proposed_corridor_id: str | None = None
    proposed_window_start: datetime | None = None
    proposed_window_end: datetime | None = None
    description: str
    status: str
    created_at: datetime
    decided_at: datetime | None = None
    decided_by: str | None = None
    decision_reason: str | None = None
    defect_type: str | None = None
    severity_code: str | None = None
    estimated_block_hours: float | None = None
    original_window_start: datetime | None = None
    original_window_end: datetime | None = None


class DecisionBody(BaseModel):
    model_config = CamelModel
    approve: bool
    reason: str | None = None


class RejectPlanBody(BaseModel):
    model_config = CamelModel
    reason: str | None = None


class BulkPlanResult(BaseModel):
    model_config = CamelModel
    zone: str
    plan_id: uuid.UUID | None = None
    period_label: str | None = None
    objective_value: float
    solver_status: str | None = None
    assignments: int
    zero_score_pending: int
    error: str | None = None


class RescheduleResponseBody(BaseModel):
    model_config = CamelModel
    accept: bool


class Notification(BaseModel):
    model_config = CamelModel
    notification_id: uuid.UUID
    recipient_role: str
    message: str
    related_request_id: uuid.UUID | None = None
    is_read: bool
    created_at: datetime


class CompatibilityEntry(BaseModel):
    model_config = CamelModel
    dept_a: str
    dept_b: str
    compatible: bool
    notes: str | None = None


class CorridorBlockWindow(BaseModel):
    model_config = CamelModel
    window_id: uuid.UUID
    corridor_id: str
    window_start: datetime
    window_end: datetime
    max_concurrent_depts: int


class CompatibilityOverrideEntry(BaseModel):
    model_config = CamelModel
    window_id: uuid.UUID
    dept_a: str
    dept_b: str
    compatible: bool
    notes: str | None = None
    is_override: bool = True


class SetCompatibilityOverrideBody(BaseModel):
    model_config = CamelModel
    window_id: uuid.UUID
    dept_a: str
    dept_b: str
    compatible: bool
    notes: str | None = None


class ClearCompatibilityOverrideBody(BaseModel):
    model_config = CamelModel
    window_id: uuid.UUID
    dept_a: str
    dept_b: str


class Asset(BaseModel):
    model_config = CamelModel
    asset_id: str
    corridor_id: str
    asset_type: str
    department: str
    km_marker: float | None = None


class ScheduleAssignment(BaseModel):
    model_config = CamelModel
    assignment_id: uuid.UUID
    defect_id: uuid.UUID | None = None
    department: str
    allocated_start: datetime
    allocated_end: datetime
    joint_block_group_id: uuid.UUID | None = None
    defect_type: str | None = None
    severity_code: str | None = None
    requested_by: str | None = None
    plan_status: str | None = None
    plan_period_label: str | None = None
    asset_id: str | None = None
    source_system: str | None = None
    estimated_block_hours: float | None = None
    due_date: date | None = None
    priority_score: float | None = None
    speed_restriction_kmph: int | None = None


class ScheduleTraversal(BaseModel):
    model_config = CamelModel
    train_number: str
    train_name: str | None = None
    direction: str
    depart_min: int
    arrive_min: int


class SchedulePendingRequest(BaseModel):
    model_config = CamelModel
    defect_id: uuid.UUID
    department: str
    defect_type: str
    severity_code: str
    estimated_block_hours: float
    requested_window_start: datetime | None = None
    requested_window_end: datetime | None = None
    priority_score: float | None = None
    workflow_status: str


class GoodsForecastBand(BaseModel):
    model_config = CamelModel
    forecast_id: uuid.UUID
    corridor_id: str
    forecast_date: date
    band_start: datetime
    band_end: datetime
    train_count: int
    source: str


class CorridorSchedule(BaseModel):
    model_config = CamelModel
    corridor_id: str
    windows: list[CorridorBlockWindow]
    assignments: list[ScheduleAssignment]
    pending_requests: list[SchedulePendingRequest]
    goods_forecasts: list[GoodsForecastBand] = []
    traversals: list[ScheduleTraversal] = []


class PlanDepartmentKpi(BaseModel):
    model_config = CamelModel
    jobs: int
    hours: float
    open: int


class PlanKpis(BaseModel):
    model_config = CamelModel
    plan_id: uuid.UUID
    zone: str | None
    horizon_type: str
    period_label: str
    horizon_start: date
    horizon_end: date
    days: int
    corridors_in_zone: int
    weekly_plans_included: int
    availability_pct: float
    availability_pct_unbundled: float
    affected_corridors: int
    availability_pct_affected: float
    availability_pct_affected_unbundled: float
    corridor_hours_available: float
    possession_hours: float
    job_hours: float
    hours_saved_by_joint_blocks: float
    block_events: int
    joint_blocks: int
    multi_dept_blocks: int
    jobs_scheduled: int
    open_backlog: int
    severity_a_scheduled: int
    severity_a_total: int
    speed_restrictions_scheduled: int
    speed_restrictions_total: int
    overdue_scheduled: int
    overdue_total: int
    scheduled_on_time: int
    scheduled_late: int
    passenger_trains_affected: int
    goods_paths_forecast: int
    goods_paths_conflicting: int
    departments: dict[str, PlanDepartmentKpi]


class ZoneSummary(BaseModel):
    model_config = CamelModel
    zone: str | None
    pending_requests: int
    corridors: int


class PlanHistoryEntry(BaseModel):
    model_config = CamelModel
    history_id: uuid.UUID
    plan_id: uuid.UUID
    horizon_type: str
    period_label: str
    snapshot_type: str
    snapshot_at: datetime
    payload: Any
