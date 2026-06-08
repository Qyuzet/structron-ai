"""
Structron - 2D plane-frame finite element solver (direct stiffness method).

This is the genuine numerical core: it assembles the global stiffness matrix
from beam-column elements (axial + Euler-Bernoulli bending, 3 DOF/node:
u, v, theta), applies supports and loads (nodal + element distributed),
solves K u = F, and recovers reactions, member end forces and the deflected
shape. Unlike the closed-form formulas it handles arbitrary geometry:
multi-span continuous beams, cantilevers and full portal frames.

Units: N, mm, MPa (so E in MPa, A in mm^2, I in mm^4, lengths in mm).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np


@dataclass
class Node:
    x: float
    y: float


@dataclass
class Element:
    n1: int
    n2: int
    E: float          # MPa
    A: float          # mm^2
    I: float          # mm^4 (strong axis)
    Sx: float = 0.0   # mm^3 (section modulus, for stress recovery)
    w: float = 0.0    # transverse distributed load, N/mm (local +y), optional


@dataclass
class FrameModel:
    nodes: list[Node]
    elements: list[Element]
    # node index -> (fix_u, fix_v, fix_theta)
    supports: dict[int, tuple[bool, bool, bool]] = field(default_factory=dict)
    # node index -> (Fx, Fy, M) in N, N, N*mm
    nodal_loads: dict[int, tuple[float, float, float]] = field(default_factory=dict)


def _elem_geom(model: FrameModel, e: Element):
    n1, n2 = model.nodes[e.n1], model.nodes[e.n2]
    dx, dy = n2.x - n1.x, n2.y - n1.y
    L = math.hypot(dx, dy)
    return L, dx / L, dy / L  # length, cos, sin


def _local_stiffness(E, A, I, L):
    a = E * I / L**3
    EA_L = E * A / L
    return np.array([
        [EA_L, 0, 0, -EA_L, 0, 0],
        [0, 12 * a, 6 * a * L, 0, -12 * a, 6 * a * L],
        [0, 6 * a * L, 4 * a * L * L, 0, -6 * a * L, 2 * a * L * L],
        [-EA_L, 0, 0, EA_L, 0, 0],
        [0, -12 * a, -6 * a * L, 0, 12 * a, -6 * a * L],
        [0, 6 * a * L, 2 * a * L * L, 0, -6 * a * L, 4 * a * L * L],
    ])


def _transform(c, s):
    return np.array([
        [c, s, 0, 0, 0, 0],
        [-s, c, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0],
        [0, 0, 0, c, s, 0],
        [0, 0, 0, -s, c, 0],
        [0, 0, 0, 0, 0, 1],
    ])


def _fixed_end_local(w, L):
    # transverse UDL w (N/mm, local +y): fixed-end force vector (local DOFs)
    return np.array([0, w * L / 2, w * L * L / 12, 0, w * L / 2, -w * L * L / 12])


def analyze(model: FrameModel, samples_per_elem: int = 21) -> dict:
    """Solve the frame and return displacements, reactions and member results."""
    nn = len(model.nodes)
    ndof = 3 * nn
    K = np.zeros((ndof, ndof))
    F = np.zeros(ndof)

    # nodal loads
    for ni, (fx, fy, m) in model.nodal_loads.items():
        F[3 * ni:3 * ni + 3] += [fx, fy, m]

    elem_cache = []
    for e in model.elements:
        L, c, s = _elem_geom(model, e)
        kl = _local_stiffness(e.E, e.A, e.I, L)
        T = _transform(c, s)
        kg = T.T @ kl @ T
        dofs = [3 * e.n1, 3 * e.n1 + 1, 3 * e.n1 + 2,
                3 * e.n2, 3 * e.n2 + 1, 3 * e.n2 + 2]
        for i in range(6):
            for j in range(6):
                K[dofs[i], dofs[j]] += kg[i, j]
        fef_l = _fixed_end_local(e.w, L) if e.w else np.zeros(6)
        if e.w:
            F[dofs] += -(T.T @ fef_l)  # equivalent nodal loads
        elem_cache.append((e, L, T, kl, fef_l, dofs))

    # boundary conditions
    fixed = np.zeros(ndof, dtype=bool)
    for ni, (fu, fv, ft) in model.supports.items():
        if fu:
            fixed[3 * ni] = True
        if fv:
            fixed[3 * ni + 1] = True
        if ft:
            fixed[3 * ni + 2] = True
    free = ~fixed

    u = np.zeros(ndof)
    u[free] = np.linalg.solve(K[np.ix_(free, free)], F[free])
    reactions = K @ u - F  # nonzero at fixed DOFs

    # member recovery + deflected shape
    members = []
    max_defl = 0.0
    max_moment = 0.0
    max_stress = 0.0
    for e, L, T, kl, fef_l, dofs in elem_cache:
        u_local = T @ u[dofs]
        f_local = kl @ u_local + fef_l  # true member end forces
        m1, m2 = f_local[2], f_local[5]
        # mid-span moment for a member under UDL (parabolic correction)
        m_mid = -(m1 - m2) / 2 + e.w * L * L / 8 if e.w else (m1 - m2) / 2
        m_max_member = max(abs(m1), abs(m2), abs(m_mid))
        max_moment = max(max_moment, m_max_member)
        if e.Sx:
            max_stress = max(max_stress, m_max_member / e.Sx)
        # transverse deflection via Hermite shape functions
        v1, th1, v2, th2 = u_local[1], u_local[2], u_local[4], u_local[5]
        for k in range(samples_per_elem):
            xi = k / (samples_per_elem - 1)
            N1 = 1 - 3 * xi**2 + 2 * xi**3
            N2 = L * (xi - 2 * xi**2 + xi**3)
            N3 = 3 * xi**2 - 2 * xi**3
            N4 = L * (-xi**2 + xi**3)
            v = N1 * v1 + N2 * th1 + N3 * v2 + N4 * th2
            max_defl = max(max_defl, abs(v))
        members.append({
            "n1": e.n1, "n2": e.n2, "axial_n": f_local[0],
            "moment1_nmm": m1, "moment2_nmm": m2, "m_max_nmm": m_max_member,
        })

    return {
        "displacements": u,
        "reactions": reactions,
        "members": members,
        "max_deflection_mm": max_defl,
        "max_moment_nmm": max_moment,
        "max_stress_mpa": max_stress,
        "ndof": ndof,
    }


# --- model builders --------------------------------------------------------

def simply_supported_beam(
    span_mm: float, total_force_n: float, E: float, I: float, A: float,
    Sx: float, n_elems: int = 12, load: str = "udl",
) -> FrameModel:
    """Build a horizontal simply supported beam (pin + roller) for validation."""
    n_nodes = n_elems + 1
    nodes = [Node(span_mm * i / n_elems, 0.0) for i in range(n_nodes)]
    w = total_force_n / span_mm if load == "udl" else 0.0
    elems = [
        Element(i, i + 1, E, A, I, Sx, w=w) for i in range(n_elems)
    ]
    model = FrameModel(nodes=nodes, elements=elems)
    model.supports[0] = (True, True, False)        # pin
    model.supports[n_nodes - 1] = (False, True, False)  # roller
    if load == "point-mid":
        mid = n_nodes // 2
        model.nodal_loads[mid] = (0.0, total_force_n, 0.0)
    return model


def portal_frame(
    span_mm: float, height_mm: float, total_force_n: float,
    E: float, I: float, A: float, Sx: float, n_beam: int = 8,
) -> FrameModel:
    """Two columns + a top beam carrying a UDL; pinned column bases."""
    nodes: list[Node] = []
    base_l = len(nodes); nodes.append(Node(0, 0))            # 0 base left
    top_l = len(nodes); nodes.append(Node(0, height_mm))     # 1 top left
    # beam nodes left->right at top
    beam_nodes = [top_l]
    for i in range(1, n_beam):
        beam_nodes.append(len(nodes)); nodes.append(Node(span_mm * i / n_beam, height_mm))
    top_r = len(nodes); nodes.append(Node(span_mm, height_mm))  # top right
    beam_nodes.append(top_r)
    base_r = len(nodes); nodes.append(Node(span_mm, 0))        # base right

    w = total_force_n / span_mm
    elems = [Element(base_l, top_l, E, A, I, Sx)]             # left column
    for i in range(len(beam_nodes) - 1):
        elems.append(Element(beam_nodes[i], beam_nodes[i + 1], E, A, I, Sx, w=w))
    elems.append(Element(base_r, top_r, E, A, I, Sx))         # right column

    model = FrameModel(nodes=nodes, elements=elems)
    model.supports[base_l] = (True, True, False)   # pinned base
    model.supports[base_r] = (True, True, False)
    return model


if __name__ == "__main__":
    # Validate against the Structron closed-form benchmark.
    E = 200000.0
    I = 119000 * 1e4   # HW 428x407x20x35, mm^4
    A = 361.4 * 1e2
    Sx = 5580 * 1e3
    F = 4320 * 9.81 * 3  # 127,138 N

    for load in ("udl", "point-mid"):
        m = simply_supported_beam(12000, F, E, I, A, Sx, n_elems=12, load=load)
        r = analyze(m)
        print(
            f"{load:>10}: delta_max = {r['max_deflection_mm']:.2f} mm, "
            f"sigma_max = {r['max_stress_mpa']:.2f} MPa"
        )
    print("Closed-form: udl 12.02 mm / 34.18 MPa ; point-mid 19.23 mm / 68.35 MPa")
