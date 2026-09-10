import type { Train } from "../types/domain";

export const mockTrains: Train[] = [
  { id: "T101", type: "Express", route: "ALPC -> GAMT", priorityClass: "Superfast" },
  { id: "T102", type: "Passenger", route: "ALPC -> DELY", priorityClass: "Normal" },
  { id: "F201", type: "Freight", route: "DELY -> GAMT", priorityClass: "Goods" },
  { id: "F202", type: "Freight", route: "GAMT -> ALPC", priorityClass: "Goods" },
  { id: "T103", type: "Express", route: "GAMT -> ALPC", priorityClass: "Superfast" },
];
