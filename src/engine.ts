/**
 * Beam-theory engine for selecting an H-section.
 *
 * Model: simply supported beam, strong-axis bending. Two load cases are
 * supported and may be combined with the beam self-weight:
 *   - uniformly distributed load (UDL):  Mmax = wL^2/8,  delta = 5wL^4/384EI
 *   - central point load:                Mmax = PL/4,    delta = PL^3/48EI
 *
 * Checks (Allowable Stress Design):
 *   - bending:    sigma = M / Sx  <=  sigma_allow = factor * fy
 *   - deflection: delta            <=  L / limit   (e.g. L/360)
 *
 * The "best" section is the lightest profile that passes both checks.
 */

import type {
  HBeamProfile,
  SelectionCriteria,
  BeamEvaluation,
  SelectionResult,
} from "./types";
import { HBEAM_CATALOG } from "./catalog";

const G = 9.81; // gravitational acceleration (m/s^2)

const DEFAULTS = {
  fyMpa: 240,
  allowableStressFactor: 0.66,
  deflectionLimit: 360,
  eGpa: 200,
  includeSelfWeight: true,
};

function resolve(c: SelectionCriteria): Required<SelectionCriteria> {
  return {
    spanM: c.spanM,
    loadType: c.loadType,
    udlKnPerM: c.udlKnPerM ?? 0,
    pointKn: c.pointKn ?? 0,
    fyMpa: c.fyMpa ?? DEFAULTS.fyMpa,
    allowableStressFactor:
      c.allowableStressFactor ?? DEFAULTS.allowableStressFactor,
    deflectionLimit: c.deflectionLimit ?? DEFAULTS.deflectionLimit,
    eGpa: c.eGpa ?? DEFAULTS.eGpa,
    includeSelfWeight: c.includeSelfWeight ?? DEFAULTS.includeSelfWeight,
  };
}

/** Evaluate a single profile against the criteria. */
export function evaluateBeam(
  profile: HBeamProfile,
  criteria: SelectionCriteria,
): BeamEvaluation {
  const cr = resolve(criteria);
  const L = cr.spanM; // m
  const Lmm = L * 1000; // mm
  const E = cr.eGpa * 1000; // GPa -> MPa (N/mm^2)
  const Imm4 = profile.Ix * 1e4; // cm^4 -> mm^4
  const Sxmm3 = profile.Sx * 1000; // cm^3 -> mm^3
  const sigmaAllow = cr.allowableStressFactor * cr.fyMpa; // MPa

  // self weight as a UDL (kg/m -> kN/m); note 1 kN/m === 1 N/mm
  const selfW = cr.includeSelfWeight ? (profile.weight * G) / 1000 : 0;

  let momentKnm: number;
  let deflectionMm: number;

  if (cr.loadType === "udl") {
    const w = cr.udlKnPerM + selfW; // kN/m (= N/mm)
    momentKnm = (w * L * L) / 8;
    deflectionMm = (5 * w * Math.pow(Lmm, 4)) / (384 * E * Imm4);
  } else {
    const P = cr.pointKn; // kN
    const w = selfW; // kN/m self weight still acts as UDL
    momentKnm = (P * L) / 4 + (w * L * L) / 8;
    const Pn = P * 1000; // kN -> N
    const dPoint = (Pn * Math.pow(Lmm, 3)) / (48 * E * Imm4);
    const dUdl = (5 * w * Math.pow(Lmm, 4)) / (384 * E * Imm4);
    deflectionMm = dPoint + dUdl;
  }

  const bendingStressMpa = (momentKnm * 1e6) / Sxmm3; // kN*m = 1e6 N*mm
  const allowableDeflectionMm = Lmm / cr.deflectionLimit;

  const stressRatio = bendingStressMpa / sigmaAllow;
  const deflectionRatio = deflectionMm / allowableDeflectionMm;
  const safetyFactor = Math.min(
    sigmaAllow / bendingStressMpa,
    allowableDeflectionMm / deflectionMm,
  );
  const governs = stressRatio >= deflectionRatio ? "bending" : "deflection";
  const passes = stressRatio <= 1 && deflectionRatio <= 1;

  return {
    profile,
    momentKnm,
    bendingStressMpa,
    allowableStressMpa: sigmaAllow,
    deflectionMm,
    allowableDeflectionMm,
    stressRatio,
    deflectionRatio,
    safetyFactor,
    governs,
    passes,
  };
}

/**
 * Evaluate the whole catalog and rank it. Passing profiles come first,
 * ordered by lightest weight (most economical); failing profiles follow,
 * ordered by how close they came (lowest worst-case utilisation first).
 */
export function selectBeam(
  criteria: SelectionCriteria,
  catalog: HBeamProfile[] = HBEAM_CATALOG,
): SelectionResult {
  const cr = resolve(criteria);
  const evaluations = catalog.map((p) => evaluateBeam(p, criteria));
  evaluations.sort((a, b) => {
    if (a.passes !== b.passes) return a.passes ? -1 : 1;
    if (a.passes) return a.profile.weight - b.profile.weight;
    return (
      Math.max(a.stressRatio, a.deflectionRatio) -
      Math.max(b.stressRatio, b.deflectionRatio)
    );
  });
  const recommended = evaluations.find((e) => e.passes) ?? null;
  return { criteria: cr, evaluations, recommended };
}

/** A short, human-readable explanation of the recommendation. */
export function explain(result: SelectionResult): string {
  const c = result.criteria;
  const load =
    c.loadType === "udl"
      ? `${c.udlKnPerM} kN/m UDL`
      : `${c.pointKn} kN point load at midspan`;
  const head = `Span ${c.spanM} m, ${load}, fy ${c.fyMpa} MPa, deflection limit L/${c.deflectionLimit}.`;
  if (!result.recommended) {
    return `${head}\nNo catalog section passes. The closest is ${result.evaluations[0]?.profile.name} (utilisation ${(Math.max(result.evaluations[0]?.stressRatio ?? 0, result.evaluations[0]?.deflectionRatio ?? 0) * 100).toFixed(0)}%). Consider a deeper section, higher grade, or shorter span.`;
  }
  const r = result.recommended;
  return `${head}\nLightest passing section: ${r.profile.name} (${r.profile.weight} kg/m). Bending ${r.bendingStressMpa.toFixed(0)}/${r.allowableStressMpa.toFixed(0)} MPa (${(r.stressRatio * 100).toFixed(0)}%), deflection ${r.deflectionMm.toFixed(1)}/${r.allowableDeflectionMm.toFixed(1)} mm (${(r.deflectionRatio * 100).toFixed(0)}%), governed by ${r.governs}, safety factor ${r.safetyFactor.toFixed(2)}.`;
}
