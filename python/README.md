# Structron — Python deliverable

Python port of the H-beam selection engine plus the analysis notebook, for
the SCIE6063001 Computational Physics submission. Shares the same JIS catalog
(`catalog.json`) and produces the same numbers as the TypeScript web tool.

## Contents

- `structron.py` — the engine: six load cases, FoS-based allowable stress,
  Euler buckling, catalog ranking. Pure standard library.
- `catalog.json` — 89 JIS / European H-sections (exported from the shared TS
  catalog).
- `Structron.ipynb` — the analysis notebook: benchmark validation against the
  manual report, error analysis, visualizations, and agentic selection.
- `requirements.txt` — pandas, matplotlib, numpy, jupyter, nbconvert.

## Run

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
