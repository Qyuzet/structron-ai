import type { Material } from "./types";

/** Common structural materials. fy in MPa, E in MPa. */
export const MATERIALS: Record<string, Material> = {
  Q235B: { name: "Q235B Steel", fyMpa: 235, eMpa: 200000 },
  SS400: { name: "SS400 Steel", fyMpa: 245, eMpa: 200000 },
  Q355B: { name: "Q355B Steel", fyMpa: 355, eMpa: 200000 },
  "A36": { name: "ASTM A36 Steel", fyMpa: 250, eMpa: 200000 },
  "6061-T6": { name: "6061-T6 Aluminum", fyMpa: 270, eMpa: 69000 },
};

export const DEFAULT_MATERIAL = MATERIALS.Q235B;
