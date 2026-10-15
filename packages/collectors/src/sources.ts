/**
 * Official keyless files. CWA mirrors every open-data file to this public S3
 * bucket (the target of the data.gov.tw download links); responses carry
 * `Access-Control-Allow-Origin: *`, so browsers may read them directly.
 * Measured in docs/DECISIONS.md.
 */
export const CWA_PUBLIC_BASE = "https://cwaopendata.s3.ap-northeast-1.amazonaws.com";

export const CWA_FILES = {
  warnings: `${CWA_PUBLIC_BASE}/Warning/W-C0033-001.json`,
  uv: `${CWA_PUBLIC_BASE}/Observation/O-A0003-001.json`,
  heat: `${CWA_PUBLIC_BASE}/Model/M-A0085-001.json`,
} as const;

/** F-D0047-0xx township forecast for one county (code from RAIN_FILE_CODES). */
export const cwaRainFile = (code: string) => `${CWA_PUBLIC_BASE}/Forecast/F-D0047-${code}.json`;
