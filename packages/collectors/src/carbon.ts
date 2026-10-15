/**
 * Grid carbon intensity method. Full write-up with sources: docs/METHODOLOGY-carbon.md.
 *
 * intensity = Σ(generation_i × factor_i) / Σ generation_i, over primary generation only.
 * Storage (battery and pumped-hydro discharge, and storage charging load) is excluded from
 * both sums: it re-releases electricity that was generated earlier, already counted then.
 */

export type FuelCategory =
  | "coal"
  | "gas"
  | "oil"
  | "cogeneration"
  | "nuclear"
  | "hydro"
  | "wind"
  | "solar"
  | "other-renewable"
  | "storage"
  | "storage-load"
  | "other";

export interface EmissionFactor {
  /** gCO2eq/kWh over the plant's life cycle (construction, fuel supply, operation). */
  lifecycle: number;
  /** gCO2eq/kWh at the stack only (what Taiwan's official 電力排碳係數 counts). */
  direct: number;
  /** Primary source of the two numbers. */
  source: string;
}

/**
 * Factors as compiled in Electricity Maps' config/defaults.yaml (commit d9a920f, 2026-04-28),
 * which cites the primary sources below. Cogeneration follows Electricity Maps' Taipower parser,
 * which maps 汽電共生 (COGEN) to "unknown" (assumed conventional thermal).
 */
export const EMISSION_FACTORS: Record<Exclude<FuelCategory, "storage" | "storage-load">, EmissionFactor> = {
  coal: { lifecycle: 820, direct: 760, source: "IPCC 2014 (AR5 WGIII Annex III)" },
  gas: { lifecycle: 490, direct: 370, source: "IPCC 2014 (AR5 WGIII Annex III)" },
  oil: { lifecycle: 650, direct: 406, source: "生命週期 UK POST；直接 EIA 2020／BEIS 2021" },
  cogeneration: { lifecycle: 700, direct: 575, source: "Electricity Maps「unknown」（假設為傳統火力）" },
  nuclear: { lifecycle: 12, direct: 0, source: "IPCC 2014 (AR5 WGIII Annex III)" },
  hydro: { lifecycle: 24, direct: 0, source: "IPCC 2014 (AR5 WGIII Annex III)" },
  wind: { lifecycle: 11, direct: 0, source: "IPCC 2014 (AR5 WGIII Annex III)" },
  solar: { lifecycle: 45, direct: 0, source: "IPCC 2014 (AR5 WGIII Annex III)，依 Electricity Maps 取值" },
  // Taipower's 其它再生能源 is mostly biomass / waste-to-energy, plus small geothermal.
  "other-renewable": { lifecycle: 230, direct: 0, source: "IPCC 2014 生質能（生命週期）；直接排放依 BEIS 2021 視為 0" },
  other: { lifecycle: 700, direct: 575, source: "Electricity Maps「unknown」（假設為傳統火力）" },
};

export const FACTORS_VERSION = "electricitymaps-defaults@d9a920f";

/** Same mapping as taiwan-power-dashboard `normalizeFuelType`, with 燃料油/輕油 → oil. */
export const fuelCategory = (rawType: string): FuelCategory => {
  const type = rawType.replace(/<[^>]+>/g, "").trim();
  if (type.includes("儲能負載") || type.includes("Energy Storage System Load")) return "storage-load";
  if (type.includes("抽蓄")) return "storage";
  if (type.includes("燃氣")) return "gas";
  if (type.includes("燃煤")) return "coal";
  if (type.includes("太陽能")) return "solar";
  if (type.includes("風力")) return "wind";
  if (type.includes("水力")) return "hydro";
  if (type.includes("核能")) return "nuclear";
  if (type.includes("燃料油") || type.includes("燃油") || type.includes("輕油") || type.includes("柴油")) return "oil";
  if (type.includes("汽電共生")) return "cogeneration";
  if (type.includes("其它再生能源") || type.includes("地熱") || type.includes("生質")) return "other-renewable";
  if (type.includes("儲能")) return "storage";
  return "other";
};

export const LOW_CARBON: ReadonlySet<FuelCategory> = new Set(["nuclear", "hydro", "wind", "solar", "other-renewable"]);
export const RENEWABLE: ReadonlySet<FuelCategory> = new Set(["hydro", "wind", "solar", "other-renewable"]);

export interface Intensity {
  /** gCO2eq/kWh, rounded to integer. */
  lifecycle: number;
  direct: number;
  /** Primary generation (MW) the averages are taken over. */
  basisMw: number;
}

/** Generation-weighted intensity. Negative or storage values never enter the average. */
export const carbonIntensity = (mixMw: Partial<Record<FuelCategory, number>>): Intensity | null => {
  let basis = 0;
  let lifecycle = 0;
  let direct = 0;
  for (const [category, factor] of Object.entries(EMISSION_FACTORS) as Array<[keyof typeof EMISSION_FACTORS, EmissionFactor]>) {
    const mw = Math.max(0, mixMw[category] ?? 0);
    basis += mw;
    lifecycle += mw * factor.lifecycle;
    direct += mw * factor.direct;
  }
  if (basis <= 0) return null;
  return { lifecycle: Math.round(lifecycle / basis), direct: Math.round(direct / basis), basisMw: Math.round(basis * 10) / 10 };
};
