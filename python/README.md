# Structron — Python deliverable

Python port of the H-beam selection engine plus the analysis notebook, for
the SCIE6063001 Computational Physics submission. Shares the same JIS catalog
(`catalog.json`) and produces the same numbers as the TypeScript web tool.

## Contents

- `fea.py` — **2D plane-frame finite element solver** (direct stiffness method,
  beam-column elements, 3 DOF/node). Handles multi-span beams and portal frames.
  Validated to the analytical benchmark.
- `surrogate.py` — **ML surrogate**: builds a dataset by running the FE solver
  over thousands of designs, trains an MLP to predict deflection/stress
  (held-out R2 ~0.99). `python surrogate.py` prints the metrics.
- `pinn.py` — **Physics-Informed Neural Network**: solves the beam ODE
  EI w'''' = q from the equation alone (no data), matching the closed form to
  ~0.01%. `python pinn.py`.
- `report.py` — generates a multi-page `Structron_Report.pdf` (benchmark, FE
  validation, ML parity, PINN, conclusion). `python report.py`.
- `verify_external.py` — independent cross-check against **anastruct** (an
  open-source 2D structural FE library), alongside the analytical solution.
  Commercial packages (ANSYS/SAP2000) have no public API to call, so an
  established open-source FE library is used as the third independent method.
  `python verify_external.py`.
- `structron.py` — closed-form engine: six load cases, FoS allowable, Euler
  buckling, catalog ranking (used as the analytical baseline).
- `catalog.json` — 89 JIS / European H-sections (exported from the shared TS
  catalog).
- `Structron.ipynb` — the analysis notebook: closed-form benchmark + error
  analysis, FE validation + portal frame, ML surrogate + parity plots, and
  agentic selection.
- `requirements.txt` — numpy, pandas, matplotlib, scikit-learn, jupyter,
  nbconvert.

## Run

> On Windows, torch + numpy can clash on the OpenMP runtime
> (`OMP: Error #15`). If you hit it, set `KMP_DUPLICATE_LIB_OK=TRUE` before
> running, or install the CPU-only torch wheel.

```bash
pip install -r requirements.txt

# standalone engine
python structron.py

# notebook
jupyter notebook Structron.ipynb

# render the notebook to PDF (runs all cells first)
jupyter nbconvert --to pdf --execute Structron.ipynb
# (HTML if a LaTeX toolchain is not installed)
jupyter nbconvert --to html --execute Structron.ipynb
```

## Validation

The engine reproduces the manual reference report (HW 428x407x20x35, 12 m,
F = 127,138 N, FoS 3.0) to within rounding:

| Load case | sigma engine | sigma report | delta engine | delta report |
|---|---|---|---|---|
| Point load at midspan | 68.35 MPa | 68.35 MPa | 19.23 mm | 19.23 mm |
| Full UDL | 34.18 MPa | 34.18 MPa | 12.02 mm | 12.02 mm |

Euler buckling Pcr = 16,312 kN, matching the report.
