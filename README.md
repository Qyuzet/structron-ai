# Structron — H-Beam Selector

An agentic structural-optimization tool that ranks 80+ standard H-sections
(WF / IWF / JIS HW-HM-HN, plus IPE/HEB) against a load scenario and returns
the lightest section that passes every check, using Euler-Bernoulli beam
theory. Built for the SCIE6063001 Computational Physics project (**Structron**)
and embedded as a public tool in the Etzal Group site
(`/tools/h-beam-selector`).

## What it computes

Model: a **simply supported beam** under a total design force `F`, evaluated
across **six loading cases**, plus an Euler buckling check.

| Load case | Max moment | Max deflection |
|---|---|---|
| Point near support / 25% (at `a`, `b=L-a`) | `F·a·b/L` | `F·a²·b²/(3EIL)` |
| Point at midspan | `F·L/4` | `F·L³/(48EI)` |
| Full UDL (`w=F/L`) | `w·L²/8` | `5wL⁴/(384EI)` |
| Half UDL (left/right) | `9wL²/128` | `5FL³/(768EI)` |
| Euler buckling | — | `Pcr = π²EI/(KL)²` |

Checks (Allowable Stress Design): bending `σ = M/Wx ≤ fy/FoS` and deflection
`δ ≤ L/limit` (e.g. L/360), across all six cases. The **recommended** section
is the lightest catalog profile that passes the worst of all cases.

Materials: Q235B, SS400, Q355B, A36 steel and 6061-T6 aluminum.

## Two surfaces, one engine

- **TypeScript** (`src/`): used by the Etzal web tool + API. Run standalone:
  ```bash
  npx tsx src/cli.ts 12 4320 3 3   # span 12m, 4320kg, x3, FoS 3
  npx tsx src/engine.test.ts        # validates against the report
  ```
- **Python** (`python/`): the graded deliverable — `structron.py` engine +
  `Structron.ipynb` analysis notebook (benchmark validation, error analysis,
  visualization, agentic selection). Shares the same `catalog.json`.

## Validation

Reproduces the manual reference report (HW 428x407x20x35, 12 m, F = 127,138 N,
FoS 3.0): midspan point load **68.35 MPa / 19.23 mm**, full UDL **34.18 MPa /
12.02 mm**, Euler **Pcr 16,312 kN**. The agentic search then finds a section
~35% lighter that still passes every case.

## Files

- `src/` — TS engine (`types`, `materials`, `catalog`, `engine`, `cli`, tests)
- `python/` — Python engine, notebook, catalog.json, requirements, README

## Scope & limitations

Strong-axis bending only; excludes lateral-torsional buckling, shear, web
crippling and combined-axial checks. Verify against your design code before
construction.
