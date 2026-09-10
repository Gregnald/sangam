import { mockNetwork } from "../data/network";
import type { NetworkTopology, Corridor } from "../types/domain";

export const corridorService = {
  getTopology: async (): Promise<NetworkTopology> => {
    return mockNetwork;
  },
  getCorridors: async (): Promise<Corridor[]> => {
    return mockNetwork.corridors;
  }
};
