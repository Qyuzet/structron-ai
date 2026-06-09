"""
Generate the report figures (PNG) and print the mesh-convergence table.

Run:  python make_report_figures.py
Outputs: fig1_deflection_curve.png, fig2_moment_shear.png,
         fig3_utilisation_bars.png, fig4_cross_section.png
"""

from __future__ import annotations

import os
import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

import structron as st
import fea

plt.rcParams.update(
    {"figure.dpi": 140, "font.size": 10, "axes.grid": True, "grid.alpha": 0.25}
)

scn = st.Scenario(
    span_mm=12000.0,
    total_force_n=4320 * 9.81 * 3,
    material=st.MATERIALS["Q235B"],
    fos=3.0,
    deflection_limit=360.0,
)
cat = st.load_catalog()
rec = next(p for p in cat if p["name"] == "HN 700x300x13x24")
rep = st.evaluate_beam(rec, scn)
E = scn.material["E"]
I = rec["Ix"] * 1e4
A = rec["area"] * 1e2
Sx = rec["Sx"] * 1e3
L = scn.span_mm
F = scn.total_force_n
w = F / L
x = np.linspace(0, L, 400)
analytical = 5 * w * L**4 / (384 * E * I)


def vm(points, segs):
    """Numerical shear (kN) and moment (kN*m) for point loads + UDL segments."""
    wtot = sum(p for p, _ in points) + sum(q * (b - a) for q, a, b in segs)
    ml = sum(p * a for p, a in points) + sum(
        q * (b - a) * ((a + b) / 2) for q, a, b in segs
    )
    rr = ml / L
    rl = wtot - rr
    v = np.full_like(x, rl)
    for p, a in points:
        v -= np.where(x >= a, p, 0.0)
    for q, a, b in segs:
        v -= np.clip(x - a, 0, b - a) * q
    m = np.concatenate([[0], np.cumsum((v[1:] + v[:-1]) / 2 * np.diff(x))])
    return v / 1000.0, m / 1e6


cases = {
    "1 point near (1m)": ([(F, 1000.0)], []),
    "2 point 25% (3m)": ([(F, 3000.0)], []),
    "3 point mid (6m)": ([(F, 6000.0)], []),
    "4 UDL full": ([], [(w, 0, L)]),
    "5 UDL left half": ([], [(w, 0, L / 2)]),
    "6 UDL right half": ([], [(w, L / 2, L)]),
}

# Table 5
print(f"Analytical target = {analytical:.4f} mm ({rec['name']})")
print(f"{'Elements':>8} {'FE (mm)':>10} {'Error':>10}")
for n in [1, 3, 5, 9, 17, 33]:
    d = fea.analyze(
        fea.simply_supported_beam(L, F, E, I, A, Sx, n_elems=n, load="udl")
    )["max_deflection_mm"]
    print(f"{n:>8} {d:>10.4f} {abs(d - analytical) / analytical * 100:>9.2f}%")

# Figure 1
defl = w * x * (L**3 - 2 * L * x**2 + x**3) / (24 * E * I)
fig, ax = plt.subplots(figsize=(7, 3.2))
ax.plot(x / 1000, -defl, color="#1f77b4", lw=2)
ax.axhline(0, color="#aaa", lw=0.8)
ax.set_xlabel("Position along span (m)")
ax.set_ylabel("Deflection (mm)")
ax.set_title(f"Deflection curve - governing case (UDL), max {defl.max():.2f} mm")
ax.invert_yaxis()
fig.tight_layout()
fig.savefig("fig1_deflection_curve.png")
plt.close(fig)

# Figure 2
fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 3.6))
for name, (pts, segs) in cases.items():
    v, m = vm(pts, segs)
    a1.plot(x / 1000, m, lw=1.4, label=name)
    a2.plot(x / 1000, v, lw=1.4, label=name)
a1.set_title("Bending moment M(x)")
a1.set_xlabel("Span (m)")
a1.set_ylabel("Moment (kN*m)")
a2.set_title("Shear force V(x)")
a2.set_xlabel("Span (m)")
a2.set_ylabel("Shear (kN)")
a1.legend(fontsize=7, loc="lower center")
a1.axhline(0, color="#aaa", lw=0.6)
a2.axhline(0, color="#aaa", lw=0.6)
fig.tight_layout()
fig.savefig("fig2_moment_shear.png")
plt.close(fig)

# Figure 3
sr = [c["stress_ratio"] * 100 for c in rep["cases"]]
dr = [c["deflection_ratio"] * 100 for c in rep["cases"]]
xb = np.arange(6)
ww = 0.38
fig, ax = plt.subplots(figsize=(8, 3.6))
ax.bar(xb - ww / 2, sr, ww, label="Stress utilisation", color="#E8A13A")
ax.bar(xb + ww / 2, dr, ww, label="Deflection utilisation", color="#1f77b4")
ax.axhline(100, color="#d33", lw=1, ls="--", label="Limit (100%)")
ax.set_xticks(xb)
ax.set_xticklabels([f"Case {i + 1}" for i in range(6)])
ax.set_ylabel("Utilisation (%)")
ax.set_title(f"Stress and deflection utilisation - {rec['name']}")
ax.legend(fontsize=8)
fig.tight_layout()
fig.savefig("fig3_utilisation_bars.png")
plt.close(fig)

# Figure 4
fig, (a1, a2) = plt.subplots(
    1, 2, figsize=(9, 3.4), gridspec_kw={"width_ratios": [1, 2]}
)
h, b, tw, tf = rec["h"], rec["b"], rec["tw"], rec["tf"]
for x0, y0, wd, ht in [
    (-b / 2, h / 2 - tf, b, tf),
    (-b / 2, -h / 2, b, tf),
    (-tw / 2, -h / 2 + tf, tw, h - 2 * tf),
]:
    a1.add_patch(plt.Rectangle((x0, y0), wd, ht, color="#1D1D1F"))
a1.set_xlim(-b * 0.7, b * 0.7)
a1.set_ylim(-h * 0.65, h * 0.65)
a1.set_aspect("equal")
a1.axis("off")
a1.set_title(f"{rec['name']}\nh={h} b={b} tw={tw} tf={tf} mm", fontsize=9)
a2.plot(x / 1000, np.zeros_like(x), "--", color="#bbb", lw=1)
a2.plot(x / 1000, -defl, color="#1f77b4", lw=2)
a2.set_title("Deflected shape (UDL)")
a2.set_xlabel("Span (m)")
a2.set_ylabel("Deflection (mm)")
a2.invert_yaxis()
fig.tight_layout()
fig.savefig("fig4_cross_section.png")
plt.close(fig)

print("saved:", sorted(f for f in os.listdir(".") if f.startswith("fig") and f.endswith(".png")))
