/**
 * CLI demo:  tsx src/cli.ts [spanM] [udlKnPerM] [fyMpa] [deflectionLimit]
 * Example:   tsx src/cli.ts 6 20 240 360
 */
import { selectBeam, explain } from "./engine";

const [, , spanArg, loadArg, fyArg, deflArg] = process.argv;

const result = selectBeam({
  spanM: spanArg ? Number(spanArg) : 6,
  loadType: "udl",
  udlKnPerM: loadArg ? Number(loadArg) : 20,
  fyMpa: fyArg ? Number(fyArg) : 240,
  deflectionLimit: deflArg ? Number(deflArg) : 360,
});

console.log(explain(result));
console.log("\nTop 5 candidates:");
for (const e of result.evaluations.slice(0, 5)) {
  console.log(
    `${e.passes ? "PASS" : "FAIL"}  ${e.profile.name.padEnd(20)} ` +
      `w=${String(e.profile.weight).padStart(5)}kg/m  ` +
      `sigma=${e.bendingStressMpa.toFixed(0).padStart(3)}MPa (${(e.stressRatio * 100).toFixed(0)}%)  ` +
      `delta=${e.deflectionMm.toFixed(1)}mm (${(e.deflectionRatio * 100).toFixed(0)}%)  ` +
      `SF=${e.safetyFactor.toFixed(2)}`,
  );
}
