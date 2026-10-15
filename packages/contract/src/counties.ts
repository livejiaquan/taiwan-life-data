export interface County {
  name: string;
  /** CWA warning geocode (W-C0033-001) — also the prefix of township geocodes. */
  geocode: string;
}

export const COUNTIES: readonly County[] = [
  { name: "基隆市", geocode: "10017" },
  { name: "臺北市", geocode: "63" },
  { name: "新北市", geocode: "65" },
  { name: "桃園市", geocode: "68" },
  { name: "新竹市", geocode: "10018" },
  { name: "新竹縣", geocode: "10004" },
  { name: "苗栗縣", geocode: "10005" },
  { name: "臺中市", geocode: "66" },
  { name: "彰化縣", geocode: "10007" },
  { name: "南投縣", geocode: "10008" },
  { name: "雲林縣", geocode: "10009" },
  { name: "嘉義市", geocode: "10020" },
  { name: "嘉義縣", geocode: "10010" },
  { name: "臺南市", geocode: "67" },
  { name: "高雄市", geocode: "64" },
  { name: "屏東縣", geocode: "10013" },
  { name: "宜蘭縣", geocode: "10002" },
  { name: "花蓮縣", geocode: "10015" },
  { name: "臺東縣", geocode: "10014" },
  { name: "澎湖縣", geocode: "10016" },
  { name: "金門縣", geocode: "09020" },
  { name: "連江縣", geocode: "09007" },
];

const COUNTY_NAMES = new Set(COUNTIES.map((c) => c.name));

/** Accepts "台北市" / "臺北市" / " 臺北市 " and returns the official name, or undefined. */
export const normalizeCountyName = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const name = value.trim().replace(/^台/, "臺");
  return COUNTY_NAMES.has(name) ? name : undefined;
};
