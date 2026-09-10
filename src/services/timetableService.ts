import type { Train, ScheduleEvent } from "../types/domain";
import { mockSchedules as schedulesData } from "../data/schedules";
import { mockTrains as trainsData } from "../data/trains";

export const timetableService = {
  getTrains: async (): Promise<Train[]> => {
    return [...trainsData];
  },
  getSchedules: async (): Promise<ScheduleEvent[]> => {
    return [...schedulesData];
  }
};
