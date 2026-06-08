"""
Structron - Physics-Informed Neural Network (PINN) for the beam ODE.

Instead of fitting data, the network is trained to satisfy the governing
differential equation itself:

    EI * w''''(x) = q(x)          (Euler-Bernoulli beam)

on a simply supported span, with boundary conditions
    w(0) = w(L) = 0        (no deflection at supports)
    w''(0) = w''(L) = 0    (no moment at supports).

We non-dimensionalise x = xi * L (xi in [0,1]) so the problem becomes
    W''''(xi) = C,   C = q L^4 / (EI),
solved by a small tanh network whose 4th derivative is obtained by automatic
differentiation. The loss is the PDE residual plus the boundary terms - no
analytical or FE labels are used. We then compare the learned solution to the
closed-form deflection as validation.

Requires: torch, numpy.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn


class BeamPINN(nn.Module):
    def __init__(self, hidden: int = 40, layers: int = 3):
        super().__init__()
        seq: list[nn.Module] = [nn.Linear(1, hidden), nn.Tanh()]
        for _ in range(layers - 1):
            seq += [nn.Linear(hidden, hidden), nn.Tanh()]
        seq += [nn.Linear(hidden, 1)]
        self.net = nn.Sequential(*seq)

    def forward(self, xi):
        return self.net(xi)


def _d(y, x):
    return torch.autograd.grad(y, x, torch.ones_like(y), create_graph=True)[0]


def solve_udl(span_mm: float, q_npmm: float, E: float, I: float,
              epochs: int = 4000, n_col: int = 100, seed: int = 0):
    """Train a PINN for a simply supported beam under UDL. Returns model + C."""
    torch.manual_seed(seed)
    C = q_npmm * span_mm**4 / (E * I)  # W'''' = C in non-dim coords
    model = BeamPINN()
    xi = torch.linspace(0, 1, n_col).reshape(-1, 1).requires_grad_(True)
    bc = torch.tensor([[0.0], [1.0]], requires_grad=True)

    def loss_fn():
        w = model(xi)
        w4 = _d(_d(_d(_d(w, xi), xi), xi), xi)
        pde = ((w4 - C) / C) ** 2
        wb = model(bc)
        wb2 = _d(_d(wb, bc), bc)
        # weight BCs strongly so the shape/scale is pinned correctly
        return pde.mean() + 50.0 * (wb**2).mean() + 50.0 * ((wb2 / C) ** 2).mean()

    # phase 1: Adam to get into the basin
    adam = torch.optim.Adam(model.parameters(), lr=3e-3)
    for _ in range(epochs):
        adam.zero_grad()
        loss = loss_fn()
        loss.backward()
        adam.step()

    # phase 2: LBFGS to converge tightly (excellent for smooth PINNs)
    lbfgs = torch.optim.LBFGS(model.parameters(), max_iter=1500,
                              tolerance_grad=1e-12, tolerance_change=1e-14,
                              line_search_fn="strong_wolfe")

    def closure():
        lbfgs.zero_grad()
        loss = loss_fn()
        loss.backward()
        return loss

    lbfgs.step(closure)
    return model, C


def evaluate(model, span_mm, q_npmm, E, I, n: int = 101):
    """Compare the PINN solution to the closed-form deflection."""
    xi = np.linspace(0, 1, n)
    with torch.no_grad():
        w_pinn = model(torch.tensor(xi, dtype=torch.float32).reshape(-1, 1)).numpy().ravel()
    # closed form: w(x) = q/(24EI) (x^4 - 2 L x^3 + L^3 x)
    x = xi * span_mm
    w_exact = q_npmm / (24 * E * I) * (x**4 - 2 * span_mm * x**3 + span_mm**3 * x)
    max_err = float(np.max(np.abs(w_pinn - w_exact)))
    rel = max_err / float(np.max(np.abs(w_exact))) * 100
    return {
        "xi": xi, "w_pinn": w_pinn, "w_exact": w_exact,
        "pinn_max_mm": float(np.max(np.abs(w_pinn))),
        "exact_max_mm": float(np.max(np.abs(w_exact))),
        "max_abs_err_mm": max_err, "max_rel_err_pct": rel,
    }


if __name__ == "__main__":
    E = 200000.0
    I = 119000 * 1e4
    span = 12000.0
    q = (4320 * 9.81 * 3) / span  # UDL N/mm for the benchmark force
    print("Training PINN (no data, only the differential equation)...")
    model, C = solve_udl(span, q, E, I, epochs=6000)
    r = evaluate(model, span, q, E, I)
    print(f"  PINN  max deflection = {r['pinn_max_mm']:.3f} mm")
    print(f"  Exact max deflection = {r['exact_max_mm']:.3f} mm")
    print(f"  Max error = {r['max_abs_err_mm']:.4f} mm ({r['max_rel_err_pct']:.2f}%)")
