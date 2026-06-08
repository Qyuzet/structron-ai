"""
Structron - structured PDF report generator.

Runs the full pipeline (closed-form benchmark, FE validation, ML surrogate,
PINN) and writes a multi-page Structron_Report.pdf. Uses matplotlib's
PdfPages so no extra PDF toolchain is required.

    python report.py
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.backends.backend_pdf import PdfPages  # noqa: E402

import structron as st  # noqa: E402
import fea  # noqa: E402
import surrogate  # noqa: E402
import pinn  # noqa: E402

A4 = (8.27, 11.69)


def _text_page(pdf, title, lines, subtitle=""):
    fig = plt.figure(figsize=A4)
    fig.text(0.08, 0.93, title, fontsize=20, fontweight="bold")
    if subtitle:
        fig.text(0.08, 0.90, subtitle, fontsize=11, color="0.35")
    y = 0.85
    for ln in lines:
        size = 13 if ln.startswith("# ") else 10.5
        weight = "bold" if ln.startswith("# ") else "normal"
        fig.text(0.08, y, ln.lstrip("# "), fontsize=size, fontweight=weight, color="0.15")
        y -= 0.030 if ln.startswith("# ") else 0.024
    pdf.savefig(fig)
    plt.close(fig)


def _table(ax, col_labels, rows, title):
    ax.axis("off")
    ax.set_title(title, fontsize=11, fontweight="bold", loc="left")
    t = ax.table(cellText=rows, colLabels=col_labels, loc="center", cellLoc="center")
    t.auto_set_font_size(False)
    t.set_fontsize(8)
    t.scale(1, 1.4)


def main():
    catalog = st.load_catalog()
    scn = st.Scenario(
        span_mm=12000, total_force_n=st.force_from_mass(4320, 3),
        material=st.MATERIALS["Q235B"], fos=3.0,
    )
    ref = next(p for p in catalog if p["name"] == "HW 428x407x20x35")
    rep = st.evaluate_beam(ref, scn)
    sel = st.select_beam(scn, catalog)
    recm = sel["recommended"]
    E = scn.material["E"]; I = ref["Ix"] * 1e4; A = ref["area"] * 1e2; Sx = ref["Sx"] * 1e3
    allow = scn.material["fy"] / scn.fos

    print("Running FE validation...")
    fe = {}
    for load, cid in [("udl", "udl-full"), ("point-mid", "point-mid")]:
        m = fea.simply_supported_beam(scn.span_mm, scn.total_force_n, E, I, A, Sx, 12, load)
        fe[load] = fea.analyze(m)

    print("Training ML surrogate...")
    Xs, ys = surrogate.generate_dataset(1500)
    _, _, _, met, (Xte, yte, pred) = surrogate.train_surrogate(Xs, ys)

    print("Training PINN...")
    q = scn.total_force_n / scn.span_mm
    pm, _ = pinn.solve_udl(scn.span_mm, q, E, I, 4000)
    pr = pinn.evaluate(pm, scn.span_mm, q, E, I)

    print("Writing PDF...")
    with PdfPages("Structron_Report.pdf") as pdf:
        # --- page 1: title + abstract ---
        _text_page(
            pdf,
            "Structron",
            [
                "An agentic FEA system for automated structural optimization.",
                "SCIE6063001 - Computational Physics.",
                "",
                "# Abstract",
                "This report selects the optimal hot-rolled H-section for a 12 m",
                "simply supported span carrying a factored design force of",
                f"{scn.total_force_n:,.0f} N (Q235B steel, FoS 3.0, allowable",
                f"{allow:.1f} MPa, deflection limit L/360).",
                "",
                "The analysis combines a direct-stiffness finite element solver, a",
                "machine-learning surrogate trained on FE data, a physics-informed",
                "neural network, and an agentic supplier layer that optimises for",
                "cost and availability.",
                "",
                "# Key results",
                f"Reference section: {ref['name']} ({ref['weight']} kg/m).",
                f"Optimised section: {recm['profile']['name']} "
                f"({recm['profile']['weight']} kg/m), "
                f"{(1 - recm['profile']['weight'] / ref['weight']) * 100:.1f}% lighter.",
                f"Governing stress {rep['worst_stress']['stress_mpa']:.1f} MPa "
                f"({rep['worst_stress']['stress_ratio'] * 100:.0f}% of allowable).",
                f"Euler buckling Pcr {rep['buckling_pcr_n'] / 1000:.0f} kN.",
            ],
            subtitle="Riki Awal Syahputra & Nicholas Nixon Iswanto",
        )

        # --- page 2: tables ---
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=A4)
        six = [[c["label"], f"{c['stress_mpa']:.1f}", f"{c['stress_ratio']*100:.0f}%",
                f"{c['deflection_mm']:.2f}", f"{c['deflection_ratio']*100:.0f}%",
                "PASS" if c["passes"] else "FAIL"] for c in rep["cases"]]
        _table(ax1, ["Load case", "sigma (MPa)", "Use", "delta (mm)", "Use", "Status"],
               six, f"Six-case analysis - {ref['name']}")
        fev = [[lo, f"{fe[lo]['max_deflection_mm']:.3f}",
                f"{next(c['deflection_mm'] for c in rep['cases'] if c['id']==cid):.3f}",
                f"{fe[lo]['max_stress_mpa']:.2f}",
                f"{next(c['stress_mpa'] for c in rep['cases'] if c['id']==cid):.2f}"]
               for lo, cid in [("udl", "udl-full"), ("point-mid", "point-mid")]]
        _table(ax2, ["Load", "FE delta", "Closed-form delta", "FE sigma", "Closed-form sigma"],
               fev, "Finite element validation (FE vs closed form)")
        fig.suptitle("Analysis tables", fontsize=14, fontweight="bold", x=0.08, ha="left")
        pdf.savefig(fig); plt.close(fig)

        # --- page 3: ML surrogate parity ---
        dt, dp = 10 ** yte[:, 0], 10 ** pred[:, 0]
        st2, sp = 10 ** yte[:, 1], 10 ** pred[:, 1]
        fig, ax = plt.subplots(2, 1, figsize=A4)
        ax[0].scatter(dt, dp, s=8, alpha=0.4)
        ax[0].plot([dt.min(), dt.max()], [dt.min(), dt.max()], "r--")
        ax[0].set_xlabel("FE deflection (mm)"); ax[0].set_ylabel("Surrogate")
        ax[0].set_title(f"Deflection parity (R2 = {met['deflection_r2']:.4f}, "
                        f"MAPE = {met['deflection_mape']:.2f}%)")
        ax[1].scatter(st2, sp, s=8, alpha=0.4)
        ax[1].plot([st2.min(), st2.max()], [st2.min(), st2.max()], "r--")
        ax[1].set_xlabel("FE stress (MPa)"); ax[1].set_ylabel("Surrogate")
        ax[1].set_title(f"Stress parity (R2 = {met['stress_r2']:.4f}, "
                        f"MAPE = {met['stress_mape']:.2f}%)")
        fig.suptitle("ML surrogate (trained on FE data)", fontsize=14, fontweight="bold")
        fig.tight_layout(); pdf.savefig(fig); plt.close(fig)

        # --- page 4: PINN + conclusion ---
        fig = plt.figure(figsize=A4)
        ax = fig.add_axes([0.1, 0.55, 0.82, 0.33])
        xm = pr["xi"] * scn.span_mm / 1000
        ax.plot(xm, pr["w_exact"], lw=2, label="Closed form")
        ax.plot(xm, pr["w_pinn"], "--", label="PINN (ODE only)")
        ax.invert_yaxis(); ax.set_xlabel("Position (m)"); ax.set_ylabel("Deflection (mm)")
        ax.set_title(f"PINN solution (max error {pr['max_rel_err_pct']:.2f}%)")
        ax.legend()
        fig.text(0.08, 0.45, "Conclusion", fontsize=14, fontweight="bold")
        concl = [
            "The FE solver reproduces the analytical benchmark exactly and extends",
            "to multi-span beams and portal frames the closed form cannot handle.",
            "The ML surrogate predicts the FE response to within a few percent, and",
            "the PINN recovers the deflection from the differential equation alone.",
            "The agentic supplier layer then optimises for real cost and stock.",
            "Scope: strong-axis bending; LTB, shear and combined axial are excluded.",
        ]
        y = 0.40
        for ln in concl:
            fig.text(0.08, y, ln, fontsize=10.5, color="0.15"); y -= 0.024
        pdf.savefig(fig); plt.close(fig)

    print("Wrote Structron_Report.pdf")


if __name__ == "__main__":
    main()
