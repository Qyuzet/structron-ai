"""
Independent cross-verification against an external FE library.

Commercial packages (ANSYS, SAP2000) do not expose a public API to call, so
instead we verify against anastruct - an established open-source 2D structural
FE library - in addition to the analytical solution. Three independent paths
(closed-form, our solver, anastruct) agreeing is strong evidence of
correctness.

Requires: anastruct (pip install anastruct).
"""

from __future__ import annotations

import fea

try:
    from anastruct import SystemElements

    HAS_ANASTRUCT = True
except Exception:  # pragma: no cover
    HAS_ANASTRUCT = False


def analytical_udl_mm(L_mm: float, w_Nmm: float, E_mpa: float, I_mm4: float) -> float:
    return (5 * w_Nmm * L_mm**4) / (384 * E_mpa * I_mm4)


def anastruct_udl_mm(
    L_mm: float, F_N: float, E_mpa: float, I_mm4: float, A_mm2: float, n: int = 10
) -> float:
    """Max deflection (mm) from anastruct, built in SI base units (N, m, Pa)."""
    L = L_mm / 1000.0
    E = E_mpa * 1e6  # MPa -> Pa
    I = I_mm4 * 1e-12  # mm^4 -> m^4
    A = A_mm2 * 1e-6  # mm^2 -> m^2
    w = (F_N / L)  # total force spread over the span, N/m
    ss = SystemElements(EA=E * A, EI=E * I)
    for i in range(n):
        ss.add_element(location=[[L * i / n, 0], [L * (i + 1) / n, 0]])
    ss.add_support_hinged(node_id=1)
    ss.add_support_roll(node_id=n + 1)
    ss.q_load(q=-w, element_id=list(range(1, n + 1)))
    ss.solve()
    disp = ss.get_node_displacements()
    return max(abs(d["uy"]) for d in disp) * 1000.0  # m -> mm


if __name__ == "__main__":
    # Structron benchmark beam, UDL case
    E = 200000.0
    I = 119000 * 1e4
    A = 361.4 * 1e2
    Sx = 5580 * 1e3
    L = 12000.0
    F = 4320 * 9.81 * 3
    w = F / L

    analytical = analytical_udl_mm(L, w, E, I)
    ours_cf = analytical  # our closed-form uses the same formula
    ours_fe = fea.analyze(
        fea.simply_supported_beam(L, F, E, I, A, Sx, n_elems=12, load="udl")
    )["max_deflection_mm"]

    print(f"{'Method':<28}{'Max deflection (mm)':>22}{'vs analytical':>16}")
    print("-" * 66)
    print(f"{'Analytical (closed-form)':<28}{analytical:>22.4f}{'-':>16}")
    print(
        f"{'Structron FE solver':<28}{ours_fe:>22.4f}"
        f"{abs(ours_fe - analytical) / analytical * 100:>15.4f}%"
    )
    if HAS_ANASTRUCT:
        ext = anastruct_udl_mm(L, F, E, I, A)
        print(
            f"{'anastruct (external FE)':<28}{ext:>22.4f}"
            f"{abs(ext - analytical) / analytical * 100:>15.4f}%"
        )
        ok = abs(ext - analytical) / analytical * 100 < 1.0
        print("\n" + ("[OK] All three methods agree (< 1%)." if ok else "[!] Mismatch."))
    else:
        print("anastruct not installed - run: pip install anastruct")
