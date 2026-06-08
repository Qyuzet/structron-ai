import type { HBeamProfile } from "./types";

/**
 * Standard JIS hot-rolled H-sections (also marketed as WF / IWF in
 * Indonesia). Values are the published section-table figures: weight kg/m,
 * area cm^2, second moments cm^4, section moduli cm^3.
 *
 * This is a representative subset covering the common range; extend freely.
 */
export const HBEAM_CATALOG: HBeamProfile[] = [
  // --- narrow-flange series ---
  { name: "H 150x75x5x7", h: 150, b: 75, tw: 5, tf: 7, weight: 14.0, area: 17.85, Ix: 666, Iy: 49.5, Sx: 88.8, Sy: 13.2 },
  { name: "H 200x100x5.5x8", h: 200, b: 100, tw: 5.5, tf: 8, weight: 21.3, area: 27.16, Ix: 1840, Iy: 134, Sx: 184, Sy: 26.8 },
  { name: "H 250x125x6x9", h: 250, b: 125, tw: 6, tf: 9, weight: 29.6, area: 37.66, Ix: 4050, Iy: 294, Sx: 324, Sy: 47.0 },
  { name: "H 300x150x6.5x9", h: 300, b: 150, tw: 6.5, tf: 9, weight: 36.7, area: 46.78, Ix: 7210, Iy: 508, Sx: 481, Sy: 67.7 },
  { name: "H 350x175x7x11", h: 350, b: 175, tw: 7, tf: 11, weight: 49.6, area: 63.14, Ix: 13600, Iy: 984, Sx: 775, Sy: 112 },
  { name: "H 400x200x8x13", h: 400, b: 200, tw: 8, tf: 13, weight: 66.0, area: 84.12, Ix: 23700, Iy: 1740, Sx: 1190, Sy: 174 },
  { name: "H 450x200x9x14", h: 450, b: 200, tw: 9, tf: 14, weight: 76.0, area: 96.76, Ix: 33500, Iy: 1870, Sx: 1490, Sy: 187 },
  { name: "H 500x200x10x16", h: 500, b: 200, tw: 10, tf: 16, weight: 89.6, area: 114.2, Ix: 47800, Iy: 2140, Sx: 1910, Sy: 214 },
  { name: "H 600x200x11x17", h: 600, b: 200, tw: 11, tf: 17, weight: 106, area: 134.4, Ix: 77600, Iy: 2280, Sx: 2590, Sy: 228 },
  { name: "H 700x300x13x24", h: 700, b: 300, tw: 13, tf: 24, weight: 185, area: 235.5, Ix: 201000, Iy: 10800, Sx: 5760, Sy: 720 },
  // --- wide-flange (H-column) series ---
  { name: "H 250x250x9x14", h: 250, b: 250, tw: 9, tf: 14, weight: 72.4, area: 92.18, Ix: 10800, Iy: 3650, Sx: 867, Sy: 292 },
  { name: "H 300x300x10x15", h: 300, b: 300, tw: 10, tf: 15, weight: 94.0, area: 119.8, Ix: 20400, Iy: 6750, Sx: 1360, Sy: 450 },
  { name: "H 350x350x12x19", h: 350, b: 350, tw: 12, tf: 19, weight: 137, area: 173.9, Ix: 40300, Iy: 13600, Sx: 2300, Sy: 776 },
  { name: "H 400x400x13x21", h: 400, b: 400, tw: 13, tf: 21, weight: 172, area: 218.7, Ix: 66600, Iy: 22400, Sx: 3330, Sy: 1120 },
];
