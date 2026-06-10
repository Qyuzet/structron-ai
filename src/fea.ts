/**
 * 2D plane-frame finite element solver (TypeScript port of python/fea.py).
 *
 * Direct stiffness method, beam-column elements (axial + Euler-Bernoulli
 * bending, 3 DOF/node). Runs in the browser so the Frame Studio can solve
 * arbitrary structures - multi-span beams, cantilevers, portal frames -
 * client-side and animate the deflected shape. Units: N, mm, MPa.
 */

export interface FNode {
  x: number;
  y: number;
}
export interface FElement {
  n1: number;
  n2: number;
  E: number;
  A: number; // mm^2
  I: number; // mm^4
  Sx: number; // mm^3
  w?: number; // transverse UDL, N/mm (local +y)
}
export interface FrameModel {
  nodes: FNode[];
  elements: FElement[];
  supports: Record<number, [boolean, boolean, boolean]>; // fix u,v,theta
  loads: Record<number, [number, number, number]>; // Fx,Fy,M
}

export interface FrameResult {
  u: number[];
  ndof: number;
  maxDeflectionMm: number;
  maxStressMpa: number;
  maxMomentNmm: number;
  /** Per-element sampled points, undeformed and deformed (scale applied). */
  undeformed: { x: number; y: number }[][];
  deformedFn: (scale: number) => { x: number; y: number }[][];
}

function geom(m: FrameModel, e: FElement) {
  const a = m.nodes[e.n1];
  const b = m.nodes[e.n2];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  return { L, c: dx / L, s: dy / L };
}

/**
 * 6x6 stiffness matrix of ONE beam-column element in its local axes.
 * The 6 rows/cols are the element's degrees of freedom: [u1, v1, theta1, u2,
 * v2, theta2] = axial, transverse and rotation at each of the two nodes.
 * `ea` is the axial term E*A/L; `a` groups the bending terms E*I/L^3.
 */
function localK(E: number, A: number, I: number, L: number): number[][] {
  const a = (E * I) / L ** 3; // bending stiffness group
  const ea = (E * A) / L; // axial stiffness
  return [
    [ea, 0, 0, -ea, 0, 0],
    [0, 12 * a, 6 * a * L, 0, -12 * a, 6 * a * L],
    [0, 6 * a * L, 4 * a * L * L, 0, -6 * a * L, 2 * a * L * L],
    [-ea, 0, 0, ea, 0, 0],
    [0, -12 * a, -6 * a * L, 0, 12 * a, -6 * a * L],
    [0, 6 * a * L, 2 * a * L * L, 0, -6 * a * L, 4 * a * L * L],
  ];
}

function transform(c: number, s: number): number[][] {
  return [
    [c, s, 0, 0, 0, 0],
    [-s, c, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0],
    [0, 0, 0, c, s, 0],
    [0, 0, 0, -s, c, 0],
    [0, 0, 0, 0, 0, 1],
  ];
}

function matmul(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B[0].length;
  const k = B.length;
  const out = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let p = 0; p < k; p++) s += A[i][p] * B[p][j];
      out[i][j] = s;
    }
  return out;
}
function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((r) => r[j]));
}
function matvec(A: number[][], v: number[]): number[] {
  return A.map((r) => r.reduce((s, x, j) => s + x * v[j], 0));
}

/** Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((r, i) => r[n] / (M[i][i] || 1e-12));
}

function fixedEndLocal(w: number, L: number): number[] {
  return [0, (w * L) / 2, (w * L * L) / 12, 0, (w * L) / 2, -(w * L * L) / 12];
}

/**
 * The direct-stiffness FE solver. Steps:
 *   1) build the global stiffness matrix K and load vector F,
 *   2) assemble each element's stiffness into K (rotated to global axes),
 *   3) apply the supports (remove fixed DOFs),
 *   4) solve K*u = F for the nodal displacements u,
 *   5) recover member forces, stresses and the deflected shape.
 */
export function analyzeFrame(model: FrameModel): FrameResult {
  const nn = model.nodes.length; // number of nodes
  const ndof = 3 * nn; // total degrees of freedom (3 per node)
  const K = Array.from({ length: ndof }, () => new Array(ndof).fill(0)); // global stiffness K
  const F = new Array(ndof).fill(0); // global load vector F

  for (const [ni, l] of Object.entries(model.loads)) {
    const i = Number(ni) * 3;
    F[i] += l[0];
    F[i + 1] += l[1];
    F[i + 2] += l[2];
  }

  const cache: {
    e: FElement;
    L: number;
    T: number[][];
    kl: number[][];
    fef: number[];
    dofs: number[];
  }[] = [];
  for (const e of model.elements) {
    const { L, c, s } = geom(model, e);
    const kl = localK(e.E, e.A, e.I, L); // element stiffness in local axes
    const T = transform(c, s); // rotation matrix (c, s = cos, sin of the element angle)
    const kg = matmul(matmul(transpose(T), kl), T); // rotate to global axes: kg = T^T * kl * T
    const dofs = [
      3 * e.n1, 3 * e.n1 + 1, 3 * e.n1 + 2, // global DOF indices of node 1
      3 * e.n2, 3 * e.n2 + 1, 3 * e.n2 + 2, // global DOF indices of node 2
    ];
    // scatter-add this element's 6x6 stiffness into the global matrix K
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) K[dofs[i]][dofs[j]] += kg[i][j];
    const fef = e.w ? fixedEndLocal(e.w, L) : new Array(6).fill(0);
    if (e.w) {
      const eq = matvec(transpose(T), fef);
      for (let i = 0; i < 6; i++) F[dofs[i]] -= eq[i];
    }
    cache.push({ e, L, T, kl, fef, dofs });
  }

  const fixed = new Array(ndof).fill(false);
  for (const [ni, sup] of Object.entries(model.supports)) {
    const i = Number(ni) * 3;
    if (sup[0]) fixed[i] = true;
    if (sup[1]) fixed[i + 1] = true;
    if (sup[2]) fixed[i + 2] = true;
  }
  const freeIdx: number[] = [];
  for (let i = 0; i < ndof; i++) if (!fixed[i]) freeIdx.push(i);

  // Reduce the system to the FREE DOFs only (drop the fixed/support rows and
  // columns), then solve Kff * uf = Ff for the unknown free displacements.
  const Kff = freeIdx.map((r) => freeIdx.map((cc) => K[r][cc])); // reduced stiffness
  const Ff = freeIdx.map((r) => F[r]); // reduced load vector
  const uf = solveLinear(Kff, Ff); // <-- the actual FE solve (Gaussian elimination)
  const u = new Array(ndof).fill(0); // full displacement vector (fixed DOFs stay 0)
  freeIdx.forEach((idx, k) => (u[idx] = uf[k]));

  // recovery: stress, moment, and deflected-shape sampler
  let maxStress = 0;
  let maxMoment = 0;
  let maxDefl = 0;
  const NS = 12;
  const undeformed: { x: number; y: number }[][] = [];
  const localData: {
    a: FNode;
    c: number;
    s: number;
    L: number;
    ul: number[];
  }[] = [];
  for (const { e, L, T, kl, fef, dofs } of cache) {
    const ug = dofs.map((d) => u[d]);
    const ul = matvec(T, ug);
    const fl = matvec(kl, ul).map((v, i) => v + fef[i]);
    const mMax = Math.max(Math.abs(fl[2]), Math.abs(fl[5]),
      e.w ? Math.abs(-(fl[2] - fl[5]) / 2 + (e.w * L * L) / 8) : 0);
    maxMoment = Math.max(maxMoment, mMax);
    if (e.Sx) maxStress = Math.max(maxStress, mMax / e.Sx);
    const { c, s } = geom(model, e);
    const a = model.nodes[e.n1];
    localData.push({ a, c, s, L, ul });
    const und: { x: number; y: number }[] = [];
    for (let k = 0; k <= NS; k++) {
      const xi = k / NS;
      und.push({ x: a.x + c * xi * L, y: a.y + s * xi * L });
      const v =
        (1 - 3 * xi ** 2 + 2 * xi ** 3) * ul[1] +
        L * (xi - 2 * xi ** 2 + xi ** 3) * ul[2] +
        (3 * xi ** 2 - 2 * xi ** 3) * ul[4] +
        L * (-(xi ** 2) + xi ** 3) * ul[5];
      maxDefl = Math.max(maxDefl, Math.abs(v));
    }
    undeformed.push(und);
  }

  const deformedFn = (scale: number) =>
    localData.map(({ a, c, s, L, ul }) => {
      const pts: { x: number; y: number }[] = [];
      for (let k = 0; k <= NS; k++) {
        const xi = k / NS;
        const uax = (1 - xi) * ul[0] + xi * ul[3];
        const v =
          (1 - 3 * xi ** 2 + 2 * xi ** 3) * ul[1] +
          L * (xi - 2 * xi ** 2 + xi ** 3) * ul[2] +
          (3 * xi ** 2 - 2 * xi ** 3) * ul[4] +
          L * (-(xi ** 2) + xi ** 3) * ul[5];
        const dxg = c * uax - s * v;
        const dyg = s * uax + c * v;
        pts.push({
          x: a.x + c * xi * L + scale * dxg,
          y: a.y + s * xi * L + scale * dyg,
        });
      }
      return pts;
    });

  return {
    u,
    ndof,
    maxDeflectionMm: maxDefl,
    maxStressMpa: maxStress,
    maxMomentNmm: maxMoment,
    undeformed,
    deformedFn,
  };
}

// --- preset builders -------------------------------------------------------

type Sec = { E: number; A: number; I: number; Sx: number };

/** Simply supported beam at a chosen mesh density (for convergence + ML data). */
export function simpleBeamFE(
  spanMm: number,
  totalForceN: number,
  sec: Sec,
  nElems = 12,
  load: "udl" | "point-mid" = "udl",
): FrameResult {
  const nodes = Array.from({ length: nElems + 1 }, (_, i) => ({
    x: (spanMm * i) / nElems,
    y: 0,
  }));
  const w = load === "udl" ? totalForceN / spanMm : 0;
  const elements = Array.from({ length: nElems }, (_, i) => ({
    n1: i,
    n2: i + 1,
    E: sec.E,
    A: sec.A,
    I: sec.I,
    Sx: sec.Sx,
    w,
  }));
  const supports: Record<number, [boolean, boolean, boolean]> = {
    0: [true, true, false],
    [nElems]: [false, true, false],
  };
  const loads: Record<number, [number, number, number]> =
    load === "point-mid"
      ? { [Math.floor(nElems / 2)]: [0, totalForceN, 0] }
      : {};
  return analyzeFrame({ nodes, elements, supports, loads });
}

export function presetModel(
  kind: "simple" | "cantilever" | "two-span" | "portal",
  spanMm: number,
  heightMm: number,
  totalForceN: number,
  sec: Sec,
): FrameModel {
  const w = totalForceN / spanMm;
  const { E, A, I, Sx } = sec;
  if (kind === "cantilever") {
    const n = 8;
    const nodes = Array.from({ length: n + 1 }, (_, i) => ({
      x: (spanMm * i) / n,
      y: 0,
    }));
    const elements = Array.from({ length: n }, (_, i) => ({
      n1: i, n2: i + 1, E, A, I, Sx, w,
    }));
    return { nodes, elements, supports: { 0: [true, true, true] }, loads: {} };
  }
  if (kind === "two-span") {
    const n = 12;
    const nodes = Array.from({ length: n + 1 }, (_, i) => ({
      x: (spanMm * i) / n,
      y: 0,
    }));
    const elements = Array.from({ length: n }, (_, i) => ({
      n1: i, n2: i + 1, E, A, I, Sx, w,
    }));
    return {
      nodes,
      elements,
      supports: {
        0: [true, true, false],
        [n / 2]: [false, true, false],
        [n]: [false, true, false],
      },
      loads: {},
    };
  }
  if (kind === "portal") {
    const nb = 8;
    const nodes: FNode[] = [{ x: 0, y: 0 }, { x: 0, y: heightMm }];
    const beam = [1];
    for (let i = 1; i < nb; i++) {
      beam.push(nodes.length);
      nodes.push({ x: (spanMm * i) / nb, y: heightMm });
    }
    const topR = nodes.length;
    nodes.push({ x: spanMm, y: heightMm });
    beam.push(topR);
    const baseR = nodes.length;
    nodes.push({ x: spanMm, y: 0 });
    const elements: FElement[] = [{ n1: 0, n2: 1, E, A, I, Sx }];
    for (let i = 0; i < beam.length - 1; i++)
      elements.push({ n1: beam[i], n2: beam[i + 1], E, A, I, Sx, w });
    elements.push({ n1: baseR, n2: topR, E, A, I, Sx });
    return {
      nodes,
      elements,
      supports: { 0: [true, true, false], [baseR]: [true, true, false] },
      loads: {},
    };
  }
  // simple supported
  const n = 12;
  const nodes = Array.from({ length: n + 1 }, (_, i) => ({
    x: (spanMm * i) / n,
    y: 0,
  }));
  const elements = Array.from({ length: n }, (_, i) => ({
    n1: i, n2: i + 1, E, A, I, Sx, w,
  }));
  return {
    nodes,
    elements,
    supports: { 0: [true, true, false], [n]: [false, true, false] },
    loads: {},
  };
}
