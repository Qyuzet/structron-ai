# H-Beam Selector

A computational tool that ranks standard hot-rolled **H-sections (WF / IWF)**
against a set of structural criteria and returns the lightest section that
passes, using classical beam theory. Built for a Computational Physics
assignment and embedded as a public tool in the Etzal Group site
(`/tools/h-beam-selector`).

## What it computes

Model: a **simply supported beam** bent about its strong axis, under either a
uniformly distributed load (UDL) or a central point load, optionally
including the beam's own self-weight.

| Quantity | UDL | Central point load |
|---|---|---|
| Max moment `M` | `w·L² / 8` | `P·L / 4` |
| Max deflection `δ` | `5·w·L⁴ / (384·E·I)` | `P·L³ / (48·E·I)` |

Checks (Allowable Stress Design):

- **Bending:** `σ = M / Sₓ ≤ σ_allow = factor · f_y` (default factor 0.66)
- **Deflection:** `δ ≤ L / limit` (default `L/360`)

The **recommended** section is the lightest catalog profile that passes both
checks. Safety factor = `min(σ_allow/σ, δ_allow/δ)`.

### Units

Catalog properties use engineering units (mm, cm², cm³, cm⁴, kg/m); the
engine converts to SI internally (N, mm, MPa). Self-weight uses `g = 9.81`.

## Usage

```ts
import { selectBeam, explain } from "@etzal/hbeam-selector";

const result = selectBeam({
  spanM: 6,
  loadType: "udl",
  udlKnPerM: 20,
  fyMpa: 240,
  deflectionLimit: 360,
});

console.log(explain(result));
console.log(result.recommended?.profile.name); // lightest passing section
```

### Run standalone

```bash
npx tsx src/cli.ts 6 20 240 360   # span 6m, 20 kN/m UDL, fy 240, L/360
npx tsx src/engine.test.ts        # sanity tests
```

## Files

- `src/types.ts` — domain types (profile, criteria, evaluation)
- `src/catalog.ts` — JIS/SNI H-section table (subset)
- `src/engine.ts` — beam-theory engine (moment, stress, deflection, ranking)
- `src/cli.ts` — command-line demo
- `src/engine.test.ts` — sanity tests

## Notes & limitations

- Strong-axis bending only; no lateral-torsional buckling, shear, web
  crippling, or combined axial checks (kept to the scope of the assignment).
- Catalog is a representative subset; extend `HBEAM_CATALOG` as needed.
- Section-table values are nominal published figures.
