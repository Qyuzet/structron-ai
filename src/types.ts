/**
 * Domain types for the H-beam selector.
 *
 * Section properties follow standard JIS / SNI hot-rolled H-section tables.
 * Units in the catalog are the conventional engineering ones (cm, cm^2,
 * cm^3, cm^4, kg/m); the engine converts to SI internally.
 */

export interface HBeamProfile {
  /** Designation, e.g. "H 300x150x6.5x9". */
  name: string;
  /** Nominal overall depth h (mm). */
  h: number;
  /** Nominal flange width b (mm). */
  b: number;
  /** Web thickness tw (mm). */
  tw: number;
  /** Flange thickness tf (mm). */
  tf: number;
  /** Self weight (kg/m). */
  weight: number;
  /** Cross-section area A (cm^2). */
  area: number;
  /** Second moment of area about the strong axis, Ix (cm^4). */
  Ix: number;
  /** Second moment of area about the weak axis, Iy (cm^4). */
  Iy: number;
  /** Section modulus, strong axis, Sx (cm^3). */
  Sx: number;
  /** Section modulus, weak axis, Sy (cm^3). */
  Sy: number;
}

export type LoadType = "udl" | "point-center";

export interface SelectionCriteria {
  /** Clear span L (m). */
  spanM: number;
  /** How the load is applied. */
  loadType: LoadType;
  /** Uniformly distributed load magnitude (kN/m). Used when loadType="udl". */
  udlKnPerM?: number;
  /** Central point load magnitude (kN). Used when loadType="point-center". */
  pointKn?: number;
  /** Steel yield strength fy (MPa). Default 240 (SS400 / Bj37). */
  fyMpa?: number;
  /**
   * Allowable bending stress as a fraction of fy (ASD). Default 0.66 per
   * AISC ASD for compact sections; use 0.6 for a conservative check.
   */
  allowableStressFactor?: number;
  /** Deflection limit denominator, e.g. 360 for L/360. Default 360. */
  deflectionLimit?: number;
  /** Young's modulus E (GPa). Default 200. */
  eGpa?: number;
  /** Include the beam self-weight in the load. Default true. */
  includeSelfWeight?: boolean;
}

export interface BeamEvaluation {
  profile: HBeamProfile;
  /** Maximum bending moment (kN*m). */
  momentKnm: number;
  /** Actual bending stress (MPa). */
  bendingStressMpa: number;
  /** Allowable bending stress (MPa). */
  allowableStressMpa: number;
  /** Maximum deflection (mm). */
  deflectionMm: number;
  /** Allowable deflection (mm). */
  allowableDeflectionMm: number;
  /** stress / allowable stress (<=1 passes). */
  stressRatio: number;
  /** deflection / allowable deflection (<=1 passes). */
  deflectionRatio: number;
  /** min(allowable/actual) across checks; >=1 means safe. */
  safetyFactor: number;
  /** Governing limit: which check is closest to (or over) the limit. */
  governs: "bending" | "deflection";
  passes: boolean;
}

export interface SelectionResult {
  criteria: Required<SelectionCriteria>;
  /** All evaluated beams, passing ones first then by lightest weight. */
  evaluations: BeamEvaluation[];
  /** The lightest passing beam, or null if none pass. */
  recommended: BeamEvaluation | null;
}
