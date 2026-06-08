/**
 * In-browser ML surrogate (TypeScript).
 *
 * Generates a dataset by running the FE solver over random designs, then fits
 * a log-linear regression  ln(delta) = b0 + b1 ln F + b2 ln L + b3 ln E + b4 ln I
 * by ordinary least squares. Because the deflection is a power law
 * (delta = 5 F L^3 / 384 E I for a UDL), the learned coefficients recover the
 * physical scaling exponents [F:+1, L:+3, E:-1, I:-1]; reporting them next to
 * the theoretical values is the validation that the model learned the physics.
 */

import type { HBeamProfile } from "./types";
import { simpleBeamFE } from "./fea";

export interface SurrogateFit {
  /** [intercept, lnF, lnL, lnE, lnI] in log space. */
  coef: number[];
  /** Theoretical exponents for UDL deflection. */
  theoretical: number[];
  labels: string[];
  r2: number;
  n: number;
  /** Held-out-ish parity points (actual vs predicted, mm). */
  sample: { actual: number; pred: number }[];
  predict: (F: number, L: number, E: number, I: number) => number;
}

/** Solve A x = b (Gaussian elimination, partial pivot). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (M[i][i] || 1e-12));
}

export function fitDeflectionSurrogate(
  catalog: HBeamProfile[],
  n = 500,
  seed = 1,
): SurrogateFit {
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const L = 3000 + rnd() * 12000;
    const F = 10000 + rnd() * 300000;
    const E = rnd() < 0.5 ? 200000 : 69000;
    const p = catalog[Math.floor(rnd() * catalog.length)];
    const sec = { E, A: p.area * 1e2, I: p.Ix * 1e4, Sx: p.Sx * 1e3 };
    const d = simpleBeamFE(L, F, sec, 10, "udl").maxDeflectionMm;
    if (!(d > 0) || !isFinite(d)) continue;
    X.push([1, Math.log(F), Math.log(L), Math.log(E), Math.log(sec.I)]);
    y.push(Math.log(d));
  }

  const k = 5;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++)
    for (let a = 0; a < k; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  const coef = solve(XtX, Xty);

  const ymean = y.reduce((a, b) => a + b, 0) / y.length;
  let ssr = 0;
  let sst = 0;
  const sample: { actual: number; pred: number }[] = [];
  const step = Math.max(1, Math.ceil(X.length / 80));
  for (let i = 0; i < X.length; i++) {
    let yh = 0;
    for (let a = 0; a < k; a++) yh += coef[a] * X[i][a];
    ssr += (y[i] - yh) ** 2;
    sst += (y[i] - ymean) ** 2;
    if (i % step === 0)
      sample.push({ actual: Math.exp(y[i]), pred: Math.exp(yh) });
  }

  const predict = (F: number, L: number, E: number, I: number) =>
    Math.exp(
      coef[0] +
        coef[1] * Math.log(F) +
        coef[2] * Math.log(L) +
        coef[3] * Math.log(E) +
        coef[4] * Math.log(I),
    );

  return {
    coef,
    theoretical: [NaN, 1, 3, -1, -1],
    labels: ["intercept", "ln F", "ln L", "ln E", "ln I"],
    r2: 1 - ssr / sst,
    n: X.length,
    sample,
    predict,
  };
}

/** Mesh-convergence study: max deflection vs element count, against analytical. */
export function convergenceStudy(
  spanMm: number,
  totalForceN: number,
  sec: { E: number; A: number; I: number; Sx: number },
  // odd counts: no node lands exactly at midspan, so the interpolation error
  // is visible and decreases monotonically as the mesh is refined.
  counts: number[] = [1, 3, 5, 9, 17, 33],
): { counts: number[]; deflections: number[]; analytical: number } {
  const w = totalForceN / spanMm;
  const analytical = (5 * w * Math.pow(spanMm, 4)) / (384 * sec.E * sec.I);
  const deflections = counts.map(
    (nc) => simpleBeamFE(spanMm, totalForceN, sec, nc, "udl").maxDeflectionMm,
  );
  return { counts, deflections, analytical };
}
