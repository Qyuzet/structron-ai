/**
 * Supplier availability + pricing feed.
 *
 * In real practice you do not just pick the lightest section - you pick the
 * cheapest one that a supplier actually has in stock. This module provides a
 * representative, deterministic price/stock feed per section so the optimizer
 * can minimise cost subject to availability. It is meant to be overridden at
 * runtime by the agentic quotation reader (which extracts real prices and
 * stock from a supplier's PDF/quote).
 */

export interface SupplierInfo {
  /** Price per kg of steel/aluminium (IDR). */
  pricePerKg: number;
  /** Price per metre of this section (IDR) = pricePerKg * weight. */
  pricePerM: number;
  inStock: boolean;
  /** Available stock length in metres (0 if out of stock). */
  stockM: number;
  supplier: string;
  leadDays: number;
}

const SUPPLIERS = [
  "Gunung Garuda",
  "Krakatau Steel",
  "Master Steel",
  "Hanwa Indonesia",
];

// Deterministic 0..1 hash so the feed is stable per section name.
function h(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0) / 4294967296;
}

export function getSupplierInfo(name: string, weightKgPerM: number): SupplierInfo {
  const a = h(name);
  const b = h(name + "#stock");
  const pricePerKg = Math.round(14000 + a * 4000); // 14k-18k IDR/kg
  const inStock = b > 0.18; // ~82% of sections in stock
  return {
    pricePerKg,
    pricePerM: Math.round(pricePerKg * weightKgPerM),
    inStock,
    stockM: inStock ? Math.round(12 + b * 48) : 0,
    supplier: SUPPLIERS[Math.floor(h(name + "#sup") * SUPPLIERS.length)],
    leadDays: inStock ? Math.round(2 + a * 8) : Math.round(21 + a * 28),
  };
}

/** Total material cost for a section over a span (IDR). */
export function totalCost(
  info: SupplierInfo,
  spanMm: number,
): number {
  return Math.round(info.pricePerM * (spanMm / 1000));
}
