"""
Structron - machine-learning surrogate for the FE solver.

We generate a labelled dataset by running the finite element solver over
randomised (span, load, material, section, load-case) combinations, then
train a neural-network regressor to predict the structural response
(max deflection and max bending stress) directly from the design features.

The trained surrogate evaluates a section in microseconds instead of running
a full FE solve, so the agentic selector can screen 80+ candidates instantly
and only run the exact FE check on the shortlisted optimum. We report the
held-out error (R^2 / MAE) as the validation that the model learned the
physics.

Requires: numpy, scikit-learn.
"""

from __future__ import annotations

import random

import numpy as np

import fea
from structron import load_catalog, MATERIALS


FEATURES = ["span_mm", "force_n", "E", "Ix_mm4", "Sx_mm3", "is_point"]


def generate_dataset(n: int = 3000, seed: int = 42):
    """Run the FE solver over random designs and collect features + targets."""
    rng = random.Random(seed)
    catalog = load_catalog()
    mats = list(MATERIALS.values())
    X, y = [], []
    attempts = 0
    while len(X) < n and attempts < n * 20:
        attempts += 1
        span = rng.uniform(3000, 15000)            # mm
        force = rng.uniform(10_000, 350_000)       # N
        mat = rng.choice(mats)
        sec = rng.choice(catalog)
        is_point = rng.random() < 0.5
        load = "point-mid" if is_point else "udl"
        model = fea.simply_supported_beam(
            span, force, mat["E"], sec["Ix"] * 1e4, sec["area"] * 1e2,
            sec["Sx"] * 1e3, n_elems=10, load=load,
        )
        r = fea.analyze(model, samples_per_elem=11)
        defl, stress = r["max_deflection_mm"], r["max_stress_mpa"]
        # keep the realistic design envelope (skip absurd over/under-stressed combos)
        if not (0.05 <= defl <= span / 10 and 1.0 <= stress <= 1500):
            continue
        X.append([span, force, mat["E"], sec["Ix"] * 1e4, sec["Sx"] * 1e3, int(is_point)])
        # log10 both targets: they span several orders of magnitude
        y.append([np.log10(defl), np.log10(stress)])
    return np.array(X), np.array(y)


def train_surrogate(X, y, test_frac: float = 0.2, seed: int = 0):
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import StandardScaler
    from sklearn.neural_network import MLPRegressor
    from sklearn.metrics import r2_score, mean_absolute_error

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=test_frac, random_state=seed)
    xs = StandardScaler().fit(Xtr)
    ys = StandardScaler().fit(ytr)
    # lbfgs converges well on this smooth (log-linear) regression problem.
    model = MLPRegressor(
        hidden_layer_sizes=(128, 128),
        activation="tanh",
        solver="lbfgs",
        max_iter=4000,
        random_state=seed,
    )
    model.fit(xs.transform(Xtr), ys.transform(ytr))

    pred = ys.inverse_transform(model.predict(xs.transform(Xte)))
    # back-transform both targets from log10
    defl_pred, defl_true = 10 ** pred[:, 0], 10 ** yte[:, 0]
    stress_pred, stress_true = 10 ** pred[:, 1], 10 ** yte[:, 1]

    def mape(t, p):
        return float(np.mean(np.abs((t - p) / t)) * 100)

    metrics = {
        "deflection_r2": r2_score(defl_true, defl_pred),
        "deflection_mae_mm": mean_absolute_error(defl_true, defl_pred),
        "deflection_mape": mape(defl_true, defl_pred),
        "stress_r2": r2_score(stress_true, stress_pred),
        "stress_mae_mpa": mean_absolute_error(stress_true, stress_pred),
        "stress_mape": mape(stress_true, stress_pred),
        "n_train": len(Xtr),
        "n_test": len(Xte),
    }
    return model, xs, ys, metrics, (Xte, yte, pred)


def predict(model, xs, ys, span_mm, force_n, E, Ix_mm4, Sx_mm3, is_point):
    feat = np.array([[span_mm, force_n, E, Ix_mm4, Sx_mm3, int(is_point)]])
    out = ys.inverse_transform(model.predict(xs.transform(feat)))[0]
    return {"deflection_mm": float(10 ** out[0]), "stress_mpa": float(out[1])}


if __name__ == "__main__":
    print("Generating FE dataset...")
    X, y = generate_dataset(3000)
    print(f"  {len(X)} samples, {X.shape[1]} features")
    print("Training surrogate neural network...")
    model, xs, ys, m, _ = train_surrogate(X, y)
    print(f"  ({m['n_train']} train / {m['n_test']} test)")
    print("Held-out performance:")
    print(f"  Deflection: R2 = {m['deflection_r2']:.4f}, MAPE = {m['deflection_mape']:.2f}%, MAE = {m['deflection_mae_mm']:.3f} mm")
    print(f"  Stress:     R2 = {m['stress_r2']:.4f}, MAPE = {m['stress_mape']:.2f}%, MAE = {m['stress_mae_mpa']:.3f} MPa")
