/**
 * Structron beam-theory engine.
 *
 * Evaluates an H-section against the six Structron loading scenarios on a
 * simply supported span, plus an Euler buckling stability check, and ranks
 * the catalog to find the lightest section that passes every case.
 *
 * Conventions: total design force F (N) is applied to the span. Point cases
 * place F at a position; UDL cases spread it as w = F/L. Allowable stress is
 * fy / FoS (Structron ASD); allowable deflection is L / limit (e.g. L/360).
 *
 * Load-case formulas (simply supported, strong-axis bending):
 *   point at a (b=L-a):  M = F a b / L,        delta = F a^2 b^2 / (3 E I L)
 *   point at midspan:    M = F L / 4,          delta = F L^3 / (48 E I)
 *   full UDL (w=F/L):    M = w L^2 / 8,         delta = 5 w L^4 / (384 E I)
 *   half UDL (w=F/L):    M = 9 w L^2 / 128,     delta = 5 F L^3 / (768 E I)
 *   Euler buckling:      Pcr = pi^2 E I / (K L)^2
 */

import type {
  HBeamProfile,
  Scenario,
  LoadCaseId,
  LoadCaseResult,
  BeamReport,
  SelectionReport,
} from "./types";
import { DEFAULT_MATERIAL } from "./materials";
import { HBEAM_CATALOG } from "./catalog";
import { getSupplierInfo, totalCost } from "./suppliers";

export const LOAD_CASE_LABELS: Record<LoadCaseId, string> = {
  "point-near": "Point load near support",
  "point-quarter": "Point load at 25% span",
  "point-mid": "Point load at midspan",
  "udl-full": "Full uniformly distributed load",
  "udl-half-left": "UDL over left half",
  "udl-half-right": "UDL over right half",
};

export const LOAD_CASE_ORDER: LoadCaseId[] = [
  "point-near",
  "point-quarter",
  "point-mid",
  "udl-full",
  "udl-half-left",
  "udl-half-right",
];

function resolve(s: Scenario): Required<Scenario> {
  return {
    spanMm: s.spanMm,
    totalForceN: s.totalForceN,
    material: s.material ?? DEFAULT_MATERIAL,
    fos: s.fos ?? 3.0,
    deflectionLimit: s.deflectionLimit ?? 360,
    bucklingK: s.bucklingK ?? 1.0,
    pointNearAMm: s.pointNearAMm ?? 1000,
    objective: s.objective ?? "weight",
    requireInStock: s.requireInStock ?? false,
  };
}

/** Moment (N*mm) and deflection (mm) for a load case. */
function caseMD(
  id: LoadCaseId,
  F: number,
  L: number,
  E: number,
  I: number,
  aNear: number,
): { M: number; delta: number } {
  switch (id) {
    case "point-near": {
      const a = aNear;
      const b = L - a;
      return { M: (F * a * b) / L, delta: (F * a * a * b * b) / (3 * E * I * L) };
    }
    case "point-quarter": {
      const a = 0.25 * L;
      const b = L - a;
      return { M: (F * a * b) / L, delta: (F * a * a * b * b) / (3 * E * I * L) };
    }
    case "point-mid":
      return { M: (F * L) / 4, delta: (F * L * L * L) / (48 * E * I) };
    case "udl-full": {
      const w = F / L;
      return { M: (w * L * L) / 8, delta: (5 * w * Math.pow(L, 4)) / (384 * E * I) };
    }
    case "udl-half-left":
    case "udl-half-right": {
      const w = F / L;
      return {
        M: (9 * w * L * L) / 128,
        delta: (5 * F * L * L * L) / (768 * E * I),
      };
    }
  }
}

/** Full report for one profile under the scenario (all six cases + buckling). */
export function evaluateBeam(
  profile: HBeamProfile,
  scenario: Scenario,
): BeamReport {
  const s = resolve(scenario);
  const L = s.spanMm;
  const E = s.material.eMpa;
  const I = profile.Ix * 1e4; // cm^4 -> mm^4
  const Sx = profile.Sx * 1e3; // cm^3 -> mm^3
  const A = profile.area * 1e2; // cm^2 -> mm^2
  const allowableStressMpa = s.material.fyMpa / s.fos;
  const allowableDeflectionMm = L / s.deflectionLimit;

  const cases: LoadCaseResult[] = LOAD_CASE_ORDER.map((id) => {
    const { M, delta } = caseMD(id, s.totalForceN, L, E, I, s.pointNearAMm);
    const bendingStressMpa = M / Sx;
    const stressRatio = bendingStressMpa / allowableStressMpa;
    const deflectionRatio = delta / allowableDeflectionMm;
    return {
      id,
      label: LOAD_CASE_LABELS[id],
      momentNmm: M,
      bendingStressMpa,
      deflectionMm: delta,
      stressRatio,
      deflectionRatio,
      passes: stressRatio <= 1 && deflectionRatio <= 1,
    };
  });

  const worstStress = cases.reduce((a, b) =>
    b.stressRatio > a.stressRatio ? b : a,
  );
  const worstDeflection = cases.reduce((a, b) =>
    b.deflectionRatio > a.deflectionRatio ? b : a,
  );

  const bucklingPcrN =
    (Math.PI * Math.PI * E * I) / Math.pow(s.bucklingK * L, 2);
  const bucklingStressMpa = bucklingPcrN / A;
  const bucklingOk = bucklingPcrN > s.totalForceN;

  const stressOk = worstStress.stressRatio <= 1;
  const deflectionOk = worstDeflection.deflectionRatio <= 1;
  const passes = stressOk && deflectionOk && bucklingOk;
  const minSafetyFactor = Math.min(
    1 / worstStress.stressRatio,
    1 / worstDeflection.deflectionRatio,
  );

  const supplier = getSupplierInfo(profile.name, profile.weight);
  const totalCostIdr = totalCost(supplier, L);

  return {
    profile,
    cases,
    worstStress,
    worstDeflection,
    allowableStressMpa,
    allowableDeflectionMm,
    bucklingPcrN,
    bucklingStressMpa,
    bucklingOk,
    stressOk,
    deflectionOk,
    passes,
    minSafetyFactor,
    supplier,
    totalCostIdr,
  };
}

/**
 * Evaluate and rank the catalog. Passing profiles first (lightest weight =
 * most economical), then failing profiles by lowest worst-case utilisation.
 */
/** A price/stock override row extracted from a supplier quotation. */
export interface QuoteOverride {
  section: string;
  pricePerKg?: number;
  pricePerM?: number;
  stockM?: number;
  supplier?: string;
  leadDays?: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Apply quoted prices/stock onto matching reports and recompute cost. */
function applyOverrides(
  reports: BeamReport[],
  overrides: QuoteOverride[],
  spanMm: number,
) {
  for (const r of reports) {
    const pn = norm(r.profile.name);
    const ov = overrides.find((o) => {
      const on = norm(o.section);
      return on.length >= 4 && (pn.includes(on) || on.includes(pn));
    });
    if (!ov) continue;
    const sup = r.supplier;
    if (ov.pricePerKg != null) {
      sup.pricePerKg = ov.pricePerKg;
      sup.pricePerM = Math.round(ov.pricePerKg * r.profile.weight);
    }
    if (ov.pricePerM != null) sup.pricePerM = ov.pricePerM;
    if (ov.stockM != null) {
      sup.stockM = ov.stockM;
      sup.inStock = ov.stockM > 0;
    }
    if (ov.supplier) sup.supplier = ov.supplier;
    if (ov.leadDays != null) sup.leadDays = ov.leadDays;
    r.totalCostIdr = Math.round(sup.pricePerM * (spanMm / 1000));
  }
}

export function selectBeam(
  scenario: Scenario,
  catalog: HBeamProfile[] = HBEAM_CATALOG,
  overrides?: QuoteOverride[],
): SelectionReport {
  const s = resolve(scenario);
  const reports = catalog.map((p) => evaluateBeam(p, scenario));
  if (overrides?.length) applyOverrides(reports, overrides, s.spanMm);
  reports.sort((a, b) => {
    if (a.passes !== b.passes) return a.passes ? -1 : 1;
    if (a.passes) {
      if (s.requireInStock && a.supplier.inStock !== b.supplier.inStock)
        return a.supplier.inStock ? -1 : 1;
      return s.objective === "cost"
        ? a.totalCostIdr - b.totalCostIdr
        : a.profile.weight - b.profile.weight;
    }
    return (
      Math.max(a.worstStress.stressRatio, a.worstDeflection.deflectionRatio) -
      Math.max(b.worstStress.stressRatio, b.worstDeflection.deflectionRatio)
    );
  });
  const recommended =
    reports.find((r) => r.passes && (!s.requireInStock || r.supplier.inStock)) ??
    null;
  return { scenario: s, reports, recommended };
}

/** Build a scenario from a mass + multiplier instead of a raw force. */
export function forceFromMass(massKg: number, multiplier = 1): number {
  return massKg * 9.81 * multiplier;
}

// ---------------------------------------------------------------------------
// Audit trail: traceable, PhotoMath-style calculation steps
// ---------------------------------------------------------------------------

export interface AuditStep {
  key: string;
  label: string;
  /** Symbolic formula, e.g. "σ = M / Wx". */
  expr: string;
  /** Same formula with numbers substituted. */
  subst: string;
  /** Computed value + unit. */
  result: string;
  /** Keys of the steps this one depends on (for click-to-trace). */
  refs: string[];
}

const _num = (x: number) =>
  x.toLocaleString("en-US", { maximumFractionDigits: 2 });
const _sci = (x: number) => x.toExponential(2);

/** Build the ordered calculation steps for one section under one load case. */
export function buildAudit(
  profile: HBeamProfile,
  scenario: Scenario,
  caseId: LoadCaseId,
): AuditStep[] {
  const s = resolve(scenario);
  const L = s.spanMm;
  const E = s.material.eMpa;
  const F = s.totalForceN;
  const I = profile.Ix * 1e4;
  const Sx = profile.Sx * 1e3;
  const { M, delta } = caseMD(caseId, F, L, E, I, s.pointNearAMm);
  const sigma = M / Sx;
  const sAllow = s.material.fyMpa / s.fos;
  const dAllow = L / s.deflectionLimit;
  const Pcr = (Math.PI * Math.PI * E * I) / Math.pow(s.bucklingK * L, 2);
  const steps: AuditStep[] = [];

  // --- moment ---
  if (caseId === "point-mid") {
    steps.push({ key: "M", label: "Max moment (point at midspan)", expr: "M = F·L / 4",
      subst: `= ${_num(F)} × ${_num(L)} / 4`, result: `${_sci(M)} N·mm`, refs: [] });
  } else if (caseId.startsWith("point")) {
    const a = caseId === "point-quarter" ? 0.25 * L : s.pointNearAMm;
    const b = L - a;
    steps.push({ key: "M", label: "Max moment (point load)", expr: "M = F·a·b / L",
      subst: `= ${_num(F)} × ${_num(a)} × ${_num(b)} / ${_num(L)}`, result: `${_sci(M)} N·mm`, refs: [] });
  } else {
    const w = F / L;
    steps.push({ key: "w", label: "Distributed load", expr: "w = F / L",
      subst: `= ${_num(F)} / ${_num(L)}`, result: `${w.toFixed(2)} N/mm`, refs: [] });
    if (caseId.startsWith("udl-half"))
      steps.push({ key: "M", label: "Max moment (half UDL)", expr: "M = 9·w·L² / 128",
        subst: `= 9 × ${w.toFixed(2)} × ${_num(L)}² / 128`, result: `${_sci(M)} N·mm`, refs: ["w"] });
    else
      steps.push({ key: "M", label: "Max moment (UDL)", expr: "M = w·L² / 8",
        subst: `= ${w.toFixed(2)} × ${_num(L)}² / 8`, result: `${_sci(M)} N·mm`, refs: ["w"] });
  }

  // --- stress ---
  steps.push({ key: "sigma", label: "Bending stress", expr: "σ = M / Wx",
    subst: `= ${_sci(M)} / ${_sci(Sx)}`, result: `${sigma.toFixed(2)} MPa`, refs: ["M"] });
  steps.push({ key: "sAllow", label: "Allowable stress", expr: "σ_allow = fy / FoS",
    subst: `= ${s.material.fyMpa} / ${s.fos}`, result: `${sAllow.toFixed(2)} MPa`, refs: [] });
  steps.push({ key: "stressChk", label: "Stress utilisation", expr: "σ / σ_allow",
    subst: `= ${sigma.toFixed(1)} / ${sAllow.toFixed(1)}`,
    result: `${((sigma / sAllow) * 100).toFixed(0)}% ${sigma <= sAllow ? "PASS" : "FAIL"}`,
    refs: ["sigma", "sAllow"] });

  // --- deflection ---
  if (caseId === "point-mid")
    steps.push({ key: "delta", label: "Max deflection", expr: "δ = F·L³ / (48·E·I)",
      subst: `= ${_num(F)} × ${_num(L)}³ / (48 × ${_num(E)} × ${_sci(I)})`, result: `${delta.toFixed(2)} mm`, refs: [] });
  else if (caseId.startsWith("point")) {
    const a = caseId === "point-quarter" ? 0.25 * L : s.pointNearAMm;
    const b = L - a;
    steps.push({ key: "delta", label: "Max deflection", expr: "δ = F·a²·b² / (3·E·I·L)",
      subst: `= ${_num(F)} × ${_num(a)}² × ${_num(b)}² / (3 × ${_num(E)} × ${_sci(I)} × ${_num(L)})`,
      result: `${delta.toFixed(2)} mm`, refs: [] });
  } else if (caseId.startsWith("udl-half"))
    steps.push({ key: "delta", label: "Deflection at midspan", expr: "δ = 5·F·L³ / (768·E·I)",
      subst: `= 5 × ${_num(F)} × ${_num(L)}³ / (768 × ${_num(E)} × ${_sci(I)})`, result: `${delta.toFixed(2)} mm`, refs: [] });
  else
    steps.push({ key: "delta", label: "Max deflection", expr: "δ = 5·w·L⁴ / (384·E·I)",
      subst: `= 5 × ${(F / L).toFixed(2)} × ${_num(L)}⁴ / (384 × ${_num(E)} × ${_sci(I)})`, result: `${delta.toFixed(2)} mm`, refs: ["w"] });
  steps.push({ key: "dAllow", label: "Allowable deflection", expr: `δ_allow = L / ${s.deflectionLimit}`,
    subst: `= ${_num(L)} / ${s.deflectionLimit}`, result: `${dAllow.toFixed(2)} mm`, refs: [] });
  steps.push({ key: "deflChk", label: "Deflection utilisation", expr: "δ / δ_allow",
    subst: `= ${delta.toFixed(1)} / ${dAllow.toFixed(1)}`,
    result: `${((delta / dAllow) * 100).toFixed(0)}% ${delta <= dAllow ? "PASS" : "FAIL"}`,
    refs: ["delta", "dAllow"] });

  // --- buckling ---
  steps.push({ key: "Pcr", label: "Euler buckling load", expr: "Pcr = π²·E·I / (K·L)²",
    subst: `= π² × ${_num(E)} × ${_sci(I)} / (${s.bucklingK} × ${_num(L)})²`, result: `${_sci(Pcr)} N`, refs: [] });

  return steps;
}

/** Short, human-readable summary of the recommendation. */
export function explain(report: SelectionReport): string {
  const s = report.scenario;
  const head = `Span ${(s.spanMm / 1000).toFixed(1)} m, design force ${(s.totalForceN / 1000).toFixed(1)} kN, ${s.material.name}, allowable ${(s.material.fyMpa / s.fos).toFixed(1)} MPa (fy/${s.fos}), deflection L/${s.deflectionLimit}.`;
  if (!report.recommended) {
    const c = report.reports[0];
    return `${head}\nNo catalog section passes all six cases. Closest: ${c?.profile.name} (worst utilisation ${(Math.max(c?.worstStress.stressRatio ?? 0, c?.worstDeflection.deflectionRatio ?? 0) * 100).toFixed(0)}%).`;
  }
  const r = report.recommended;
  return `${head}\nLightest passing section: ${r.profile.name} (${r.profile.weight} kg/m). Governing stress ${r.worstStress.bendingStressMpa.toFixed(1)} MPa in "${r.worstStress.label}" (${(r.worstStress.stressRatio * 100).toFixed(0)}%); governing deflection ${r.worstDeflection.deflectionMm.toFixed(1)} mm in "${r.worstDeflection.label}" (${(r.worstDeflection.deflectionRatio * 100).toFixed(0)}%); buckling Pcr ${(r.bucklingPcrN / 1000).toFixed(0)} kN; safety factor ${r.minSafetyFactor.toFixed(2)}.`;
}
