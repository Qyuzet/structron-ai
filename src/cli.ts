/**
 * CLI demo:  tsx src/cli.ts [spanM] [massKg] [multiplier] [fos]
 * Example (Structron benchmark):  tsx src/cli.ts 12 4320 3 3
 */
import { selectBeam, explain, forceFromMass, LOAD_CASE_ORDER } from "./engine";
import { MATERIALS } from "./materials";

const [, , spanArg, massArg, multArg, fosArg] = process.argv;

const spanM = spanArg ? Number(spanArg) : 12;
const massKg = massArg ? Number(massArg) : 4320;
const mult = multArg ? Number(multArg) : 3;
const fos = fosArg ? Number(fosArg) : 3;

const report = selectBeam({
  spanMm: spanM * 1000,
  totalForceN: forceFromMass(massKg, mult),
  material: MATERIALS.Q235B,
  fos,
  deflectionLimit: 360,
  bucklingK: 1.0,
  pointNearAMm: 1000,
});

console.log(explain(report));

if (report.recommended) {
  console.log(`\nSix-case breakdown for ${report.recommended.profile.name}:`);
  const r = report.recommended;
  for (const id of LOAD_CASE_ORDER) {
    const c = r.cases.find((x) => x.id === id)!;
    console.log(
      `  ${c.label.padEnd(34)} sigma=${c.bendingStressMpa.toFixed(2).padStart(6)} MPa (${(c.stressRatio * 100).toFixed(0)}%)  ` +
        `delta=${c.deflectionMm.toFixed(2).padStart(6)} mm (${(c.deflectionRatio * 100).toFixed(0)}%)  ${c.passes ? "PASS" : "FAIL"}`,
    );
  }
  console.log(
    `  Allowable: sigma=${r.allowableStressMpa.toFixed(2)} MPa, delta=${r.allowableDeflectionMm.toFixed(2)} mm, Pcr=${(r.bucklingPcrN / 1000).toFixed(0)} kN`,
  );
}
