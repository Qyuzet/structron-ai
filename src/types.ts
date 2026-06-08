/**
 * Domain types for the Structron H-beam selector.
 *
 * Section properties follow standard JIS / SNI hot-rolled H-section tables.
 * Catalog units are the conventional engineering ones (cm, cm^2, cm^3,
 * cm^4, kg/m); the engine converts to SI (N, mm, MPa) internally.
 */

export interface HBeamProfile {
  /** Designation, e.g. "HW 428x407x20x35". */
  name: string;
  /** Series: HW (wide), HM (medium), HN (narrow). */
  series?: "HW" | "HM" | "HN";
  h: number; // overall depth (mm)
  b: number; // flange width (mm)
  tw: number; // web thickness (mm)
  tf: number; // flange thickness (mm)
  weight: number; // kg/m
  area: number; // cm^2
  Ix: number; // cm^4 (strong axis)
  Iy: number; // cm^4 (weak axis)
  Sx: number; // cm^3 (strong-axis section modulus, JIS Wx)
  Sy: number; // cm^3
}

import type { SupplierInfo } from "./suppliers";
export type { SupplierInfo };

export interface Material {
  name: string;
  /** Yield strength fy (MPa). */
  fyMpa: number;
  /** Young's modulus E (MPa). */
  eMpa: number;
}

/** The six Structron loading scenarios. */
export type LoadCaseId =
  | "point-near"
  | "point-quarter"
  | "point-mid"
  | "udl-full"
  | "udl-half-left"
  | "udl-half-right";

export interface Scenario {
  /** Clear span L (mm). */
  spanMm: number;
  /** Total design force F applied to the span (N). */
  totalForceN: number;
  material: Material;
  /** Factor of safety; allowable stress = fy / fos. Default 3.0. */
  fos: number;
  /** Deflection limit denominator, e.g. 360 for L/360. Default 360. */
  deflectionLimit: number;
  /** Effective length factor K for the buckling check. Default 1.0. */
  bucklingK: number;
  /** Position a of the "near support" point load (mm). Default 1000. */
  pointNearAMm: number;
  /** Optimisation objective: lightest weight or lowest material cost. */
  objective: "weight" | "cost";
  /** Only recommend sections a supplier has in stock. */
  requireInStock: boolean;
}

export interface LoadCaseResult {
  id: LoadCaseId;
  label: string;
  momentNmm: number;
  bendingStressMpa: number;
  deflectionMm: number;
  stressRatio: number; // vs allowable stress
  deflectionRatio: number; // vs allowable deflection
  passes: boolean;
}

export interface BeamReport {
  profile: HBeamProfile;
  cases: LoadCaseResult[];
  worstStress: LoadCaseResult;
  worstDeflection: LoadCaseResult;
  allowableStressMpa: number;
  allowableDeflectionMm: number;
  /** Euler critical buckling load (N), strong axis, Pcr = pi^2 E I / (KL)^2. */
  bucklingPcrN: number;
  bucklingStressMpa: number;
  bucklingOk: boolean;
  stressOk: boolean;
  deflectionOk: boolean;
  passes: boolean;
  /** min(allowable/worst) across stress and deflection; >=1 is safe. */
  minSafetyFactor: number;
  supplier: SupplierInfo;
  /** Total material cost over the span (IDR). */
  totalCostIdr: number;
}

export interface SelectionReport {
  scenario: Required<Scenario>;
  reports: BeamReport[]; // passing first, then lightest
  recommended: BeamReport | null;
}
