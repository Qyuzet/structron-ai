"""
Structron - H-beam selection engine (Python port).

Evaluates an H-section against the six Structron loading scenarios on a
simply supported span, plus an Euler buckling check, and ranks the JIS
catalog to find the lightest section that passes every case.

Mirrors the TypeScript engine in ../src/engine.ts. Pure standard library;
pandas/matplotlib are only needed for the notebook, not this module.

Units: total design force F in N, span L in mm, E in MPa, Ix in mm^4,
Sx in mm^3, A in mm^2. Allowable stress = fy / FoS; allowable deflection
= L / limit.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from typing import Callable

G = 9.81  # gravitational acceleration (m/s^2)

MATERIALS: dict[str, dict] = {
    "Q235B": {"name": "Q235B Steel", "fy": 235, "E": 200000},
    "SS400": {"name": "SS400 Steel", "fy": 245, "E": 200000},
    "Q355B": {"name": "Q355B Steel", "fy": 355, "E": 200000},
    "A36": {"name": "ASTM A36 Steel", "fy": 250, "E": 200000},
    "6061-T6": {"name": "6061-T6 Aluminum", "fy": 270, "E": 69000},
}

LOAD_CASES = [
    ("point-near", "Point load near support"),
    ("point-quarter", "Point load at 25% span"),
    ("point-mid", "Point load at midspan"),
    ("udl-full", "Full uniformly distributed load"),
    ("udl-half-left", "UDL over left half"),
    ("udl-half-right", "UDL over right half"),
]


def load_catalog(path: str | None = None) -> list[dict]:
    """Load the JIS catalog (shared with the TS tool) from catalog.json."""
    if path is None:
        path = os.path.join(os.path.dirname(__file__), "catalog.json")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def force_from_mass(mass_kg: float, multiplier: float = 1.0) -> float:
    return mass_kg * G * multiplier


def case_moment_deflection(case_id, F, L, E, I, a_near):
    """Return (moment N*mm, deflection mm) for a load case."""
    if case_id == "point-near":
        a, b = a_near, L - a_near
        return F * a * b / L, F * a**2 * b**2 / (3 * E * I * L)
    if case_id == "point-quarter":
        a = 0.25 * L
        b = L - a
        return F * a * b / L, F * a**2 * b**2 / (3 * E * I * L)
    if case_id == "point-mid":
        return F * L / 4, F * L**3 / (48 * E * I)
    if case_id == "udl-full":
        w = F / L
        return w * L**2 / 8, 5 * w * L**4 / (384 * E * I)
    if case_id in ("udl-half-left", "udl-half-right"):
        w = F / L
        return 9 * w * L**2 / 128, 5 * F * L**3 / (768 * E * I)
    raise ValueError(f"unknown case {case_id}")


@dataclass
class Scenario:
    span_mm: float
    total_force_n: float
    material: dict = field(default_factory=lambda: MATERIALS["Q235B"])
    fos: float = 3.0
    deflection_limit: float = 360.0
    buckling_k: float = 1.0
    point_near_a_mm: float = 1000.0


def evaluate_beam(profile: dict, s: Scenario) -> dict:
    """Full six-case + buckling report for one profile."""
    L = s.span_mm
    E = s.material["E"]
    I = profile["Ix"] * 1e4   # cm^4 -> mm^4
    Sx = profile["Sx"] * 1e3  # cm^3 -> mm^3
    A = profile["area"] * 1e2  # cm^2 -> mm^2
    allow_stress = s.material["fy"] / s.fos
    allow_defl = L / s.deflection_limit

    cases = []
    for cid, label in LOAD_CASES:
        M, delta = case_moment_deflection(cid, s.total_force_n, L, E, I, s.point_near_a_mm)
        sigma = M / Sx
        cases.append(
            {
                "id": cid,
                "label": label,
                "moment_nmm": M,
                "stress_mpa": sigma,
                "deflection_mm": delta,
                "stress_ratio": sigma / allow_stress,
                "deflection_ratio": delta / allow_defl,
                "passes": sigma <= allow_stress and delta <= allow_defl,
            }
        )

    worst_stress = max(cases, key=lambda c: c["stress_ratio"])
    worst_defl = max(cases, key=lambda c: c["deflection_ratio"])

    pcr = math.pi**2 * E * I / (s.buckling_k * L) ** 2
    buckling_ok = pcr > s.total_force_n

    stress_ok = worst_stress["stress_ratio"] <= 1
    defl_ok = worst_defl["deflection_ratio"] <= 1
    passes = stress_ok and defl_ok and buckling_ok
    sf = min(1 / worst_stress["stress_ratio"], 1 / worst_defl["deflection_ratio"])

    return {
        "profile": profile,
        "cases": cases,
        "worst_stress": worst_stress,
        "worst_deflection": worst_defl,
        "allowable_stress_mpa": allow_stress,
        "allowable_deflection_mm": allow_defl,
        "buckling_pcr_n": pcr,
        "buckling_ok": buckling_ok,
        "passes": passes,
        "min_safety_factor": sf,
    }


def select_beam(s: Scenario, catalog: list[dict] | None = None) -> dict:
    """Evaluate and rank the catalog; recommend the lightest passing section."""
    if catalog is None:
        catalog = load_catalog()
    reports = [evaluate_beam(p, s) for p in catalog]
    reports.sort(
        key=lambda r: (
            0 if r["passes"] else 1,
            r["profile"]["weight"]
            if r["passes"]
            else max(r["worst_stress"]["stress_ratio"], r["worst_deflection"]["deflection_ratio"]),
        )
    )
    recommended = next((r for r in reports if r["passes"]), None)
    return {"scenario": s, "reports": reports, "recommended": recommended}


if __name__ == "__main__":
    s = Scenario(
        span_mm=12000,
        total_force_n=force_from_mass(4320, 3),
        material=MATERIALS["Q235B"],
        fos=3.0,
    )
    result = select_beam(s)
    rec = result["recommended"]
    print(f"Total design force: {s.total_force_n:,.0f} N")
    if rec:
        print(f"Recommended: {rec['profile']['name']} ({rec['profile']['weight']} kg/m)")
        print(f"Safety factor: {rec['min_safety_factor']:.2f}")
        for c in rec["cases"]:
            print(
                f"  {c['label']:<34} sigma={c['stress_mpa']:6.2f} MPa "
                f"({c['stress_ratio']*100:4.0f}%)  delta={c['deflection_mm']:6.2f} mm "
                f"({c['deflection_ratio']*100:4.0f}%)  {'PASS' if c['passes'] else 'FAIL'}"
            )
