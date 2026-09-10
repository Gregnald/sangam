import { mockMaintenanceJobs } from "../data/maintenance";
import type { MaintenanceJob } from "../types/domain";

export const maintenanceService = {
  getJobs: async (): Promise<MaintenanceJob[]> => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return [...mockMaintenanceJobs];
  }
};
