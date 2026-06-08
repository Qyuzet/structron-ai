/**
 * Lightweight sanity tests (no test runner needed):  tsx src/engine.test.ts
 */
import assert from "node:assert";
import { evaluateBeam, selectBeam } from "./engine";
import { HBEAM_CATALOG } from "./catalog";

const beam = HBEAM_CATALOG.find((p) => p.name === "H 400x200x8x13");
assert.ok(beam, "fixture profile exists");

// UDL: w=20 kN/m, L=6 m, self weight off -> M = wL^2/8 = 90 kN*m
const ev = evaluateBeam(beam!, {
  spanM: 6,
  loadType: "udl",
  udlKnPerM: 20,
  includeSelfWeight: false,
});
assert.ok(Math.abs(ev.momentKnm - 90) < 1e-6, `moment expected 90, got ${ev.momentKnm}`);

// sigma = M/Sx = 90e6 N*mm / (1190e3 mm^3) ~= 75.6 MPa
assert.ok(
  Math.abs(ev.bendingStressMpa - 75.63) < 0.5,
  `stress expected ~75.6, got ${ev.bendingStressMpa}`,
);

// point load: P=40 kN, L=6 -> M = PL/4 = 60 kN*m (self weight off)
const evP = evaluateBeam(beam!, {
  spanM: 6,
  loadType: "point-center",
  pointKn: 40,
  includeSelfWeight: false,
});
assert.ok(Math.abs(evP.momentKnm - 60) < 1e-6, `point moment expected 60, got ${evP.momentKnm}`);

// selection: passing beams sorted by lightest weight
const res = selectBeam({ spanM: 6, loadType: "udl", udlKnPerM: 20 });
assert.ok(res.recommended, "should find a passing beam");
const passing = res.evaluations.filter((e) => e.passes);
for (let i = 1; i < passing.length; i++) {
  assert.ok(
    passing[i].profile.weight >= passing[i - 1].profile.weight,
    "passing beams are ordered by weight",
  );
}

console.log("All tests passed.");
