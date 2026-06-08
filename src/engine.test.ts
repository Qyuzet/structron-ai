/**
 * Validation against the Structron Technical Report benchmark:
 *   HW 428x407x20x35, Q235B, span 12 m, F = 4320 kg x 3 x g = 127,138 N,
 *   FoS 3.0 (allowable 78.33 MPa), L/360.
 * Run:  tsx src/engine.test.ts
 */
import assert from "node:assert";
import { evaluateBeam, forceFromMass } from "./engine";
import { HBEAM_CATALOG } from "./catalog";
import { MATERIALS } from "./materials";

const approx = (a: number, b: number, tol: number, msg: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ~${b}, got ${a.toFixed(3)}`);

const beam = HBEAM_CATALOG.find((p) => p.name === "HW 428x407x20x35");
assert.ok(beam, "Structron benchmark section exists in catalog");

const F = forceFromMass(4320, 3);
approx(F, 127138, 5, "total design force (N)");

const rep = evaluateBeam(beam!, {
  spanMm: 12000,
  totalForceN: F,
  material: MATERIALS.Q235B,
  fos: 3.0,
  deflectionLimit: 360,
  bucklingK: 1.0,
  pointNearAMm: 1000,
});

approx(rep.allowableStressMpa, 78.33, 0.1, "allowable stress");
approx(rep.allowableDeflectionMm, 33.33, 0.1, "allowable deflection");

const byId = (id: string) => rep.cases.find((c) => c.id === id)!;

// Case 3: Point load at midspan -> sigma 68.35 MPa, delta 19.23 mm
approx(byId("point-mid").bendingStressMpa, 68.35, 0.3, "Case3 stress");
approx(byId("point-mid").deflectionMm, 19.23, 0.2, "Case3 deflection");

// Case 4: Full UDL -> sigma 34.18 MPa, delta 12.02 mm
approx(byId("udl-full").bendingStressMpa, 34.18, 0.3, "Case4 stress");
approx(byId("udl-full").deflectionMm, 12.02, 0.2, "Case4 deflection");

// Case 1: Point near support -> sigma 20.88 MPa, delta 1.80 mm
approx(byId("point-near").bendingStressMpa, 20.88, 0.3, "Case1 stress");
approx(byId("point-near").deflectionMm, 1.8, 0.2, "Case1 deflection");

// Buckling Pcr ~ 16,312 kN
approx(rep.bucklingPcrN / 1000, 16312, 50, "Euler Pcr (kN)");

// worst case should be the midspan point load (87.3% stress usage)
assert.equal(rep.worstStress.id, "point-mid", "worst stress is midspan point load");
assert.ok(rep.passes, "benchmark beam passes all checks");

console.log("All Structron benchmark assertions passed.");
