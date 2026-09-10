import type { CandidateWindow, ScheduleEvent, Corridor } from "../types/domain";
import { addHours, isBefore, parseISO } from "date-fns";

export const availabilityService = {
  /**
   * Causally derives candidate windows by finding gaps between train schedules on a corridor.
   */
  deriveCandidateWindows: (
    corridors: Corridor[],
    schedules: ScheduleEvent[],
    baseDate: string,
    horizonHours: number
  ): CandidateWindow[] => {
    const windows: CandidateWindow[] = [];
    const endHorizon = addHours(parseISO(baseDate), horizonHours);
    let windowIdCounter = 1;

    for (const corridor of corridors) {
      // Get all events for this corridor, sorted by start time
      const corridorEvents = schedules
        .filter(s => s.corridorId === corridor.id)
        .sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime());

      let currentStart = parseISO(baseDate);

      for (const event of corridorEvents) {
        const eventStart = parseISO(event.start);
        const eventEnd = parseISO(event.end);

        // Gap from currentStart to eventStart
        if (isBefore(currentStart, eventStart)) {
          const durationHours = (eventStart.getTime() - currentStart.getTime()) / (1000 * 60 * 60);
          if (durationHours >= 2) { // Minimum 2 hours for a candidate window
            windows.push({
              id: `WIN-${windowIdCounter++}`,
              corridorId: corridor.id,
              start: currentStart.toISOString(),
              end: eventStart.toISOString(),
              durationHours,
              source: "Derived from timetable gap",
              status: "candidate"
            });
          }
        }
        // Update currentStart to the end of the event (or later if overlapping events, but simplified here)
        if (isBefore(currentStart, eventEnd)) {
          currentStart = eventEnd;
        }
      }

      // Check gap after last event up to horizon
      if (isBefore(currentStart, endHorizon)) {
        const durationHours = (endHorizon.getTime() - currentStart.getTime()) / (1000 * 60 * 60);
        if (durationHours >= 2) {
          windows.push({
            id: `WIN-${windowIdCounter++}`,
            corridorId: corridor.id,
            start: currentStart.toISOString(),
            end: endHorizon.toISOString(),
            durationHours,
            source: "Derived from timetable gap",
            status: "candidate"
          });
        }
      }
    }

    return windows;
  }
};
