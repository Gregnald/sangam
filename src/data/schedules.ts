import type { ScheduleEvent } from "../types/domain";

// Base date for demo purposes
const BASE_DATE = "2026-08-31T00:00:00Z";

const dt = (hoursOffset: number) => {
  const date = new Date(BASE_DATE);
  date.setHours(date.getHours() + hoursOffset);
  return date.toISOString();
};

export const mockSchedules: ScheduleEvent[] = [
  // T101 schedule (Express ALPC -> GAMT)
  { id: "EV-1", trainId: "T101", corridorId: "COR-A-B", start: dt(8), end: dt(9), eventType: "transit" },
  { id: "EV-2", trainId: "T101", corridorId: "COR-B-C", start: dt(9.25), end: dt(10.5), eventType: "transit" },
  
  // F201 schedule (Freight DELY -> GAMT)
  { id: "EV-3", trainId: "F201", corridorId: "COR-B-D", start: dt(6), end: dt(7), eventType: "transit" },
  { id: "EV-4", trainId: "F201", corridorId: "COR-B-C", start: dt(7.5), end: dt(9.5), eventType: "transit" },

  // T102 schedule
  { id: "EV-5", trainId: "T102", corridorId: "COR-A-B", start: dt(13), end: dt(14.5), eventType: "transit" },
  { id: "EV-6", trainId: "T102", corridorId: "COR-B-D", start: dt(14.75), end: dt(15.5), eventType: "transit" },

  // F202 schedule
  { id: "EV-7", trainId: "F202", corridorId: "COR-B-C", start: dt(14), end: dt(16), eventType: "transit" },
  { id: "EV-8", trainId: "F202", corridorId: "COR-A-B", start: dt(16.5), end: dt(18), eventType: "transit" },

  // T103 schedule
  { id: "EV-9", trainId: "T103", corridorId: "COR-B-C", start: dt(18), end: dt(19.25), eventType: "transit" },
  { id: "EV-10", trainId: "T103", corridorId: "COR-A-B", start: dt(19.5), end: dt(20.5), eventType: "transit" },
];
