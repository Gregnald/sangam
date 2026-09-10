import type { NetworkTopology } from "../types/domain";

export const mockNetwork: NetworkTopology = {
  stations: [
    { id: "STN-A", name: "Alpha Central", code: "ALPC" },
    { id: "STN-B", name: "Beta Junction", code: "BETJ" },
    { id: "STN-C", name: "Gamma Terminus", code: "GAMT" },
    { id: "STN-D", name: "Delta Yard", code: "DELY" },
  ],
  corridors: [
    {
      id: "COR-A-B",
      name: "Alpha-Beta Mainline",
      stations: ["STN-A", "STN-B"],
      lengthKm: 45,
    },
    {
      id: "COR-B-C",
      name: "Beta-Gamma Freight Corridor",
      stations: ["STN-B", "STN-C"],
      lengthKm: 60,
    },
    {
      id: "COR-B-D",
      name: "Beta-Delta Branch",
      stations: ["STN-B", "STN-D"],
      lengthKm: 25,
    }
  ],
  junctions: [
    {
      id: "JNC-1",
      stationId: "STN-B",
      connectingCorridors: ["COR-A-B", "COR-B-C", "COR-B-D"]
    }
  ],
  crossovers: [
    { id: "X-1", location: "Km 22.5", corridorId: "COR-A-B" },
    { id: "X-2", location: "Km 10.0", corridorId: "COR-B-C" },
  ]
};
