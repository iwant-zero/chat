// scripts/update-lotto.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const DRAWS_PATH = path.join(DATA_DIR, "lotto-draws.json");
const META_PATH = path.join(DATA_DIR, "meta.json");

const API = "https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo=";

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

async function fetchDraw(drwNo) {
  const res = await fetch(API + drwNo, {
    headers: { "User-Agent": "github-actions-lotto-updater" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // 동행복권 API는 없는 회차면 returnValue가 "fail"인 경우가 많음
  if (!data || data.returnValue !== "success") return null;

  const numbers = [
    data.drwtNo1, data.drwtNo2, data.drwtNo3, data.drwtNo4, data.drwtNo5, data.drwtNo6
  ].map(Number).sort((a, b) => a - b);

  return {
    drwNo: Number(data.drwNo),
    date: data.drwNoDate, // "YYYY-MM-DD"
    numbers,
    bonus: Number(data.bnusNo)
  };
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const meta = readJson(META_PATH, { updated_at: "1970-01-01T00:00:00Z", latest_drwNo: 0 });
  const drawsJson = readJson(DRAWS_PATH, { draws: [] });

  const draws = Array.isArray(drawsJson.draws) ? drawsJson.draws : [];
  const existing = new Map(draws.map(d => [d.drwNo, d]));

  let start = Math.max(meta.latest_drwNo || 0, 0) + 1;
  // 만약 파일에 더 큰 회차가 이미 있으면 거기서 이어가기
  const maxInFile = draws.reduce((m, d) => Math.max(m, d.drwNo || 0), 0);
  start = Math.max(start, maxInFile + 1);

  // 처음 설치된 저장소면 1회부터 쭉 가져오되, 너무 오래 걸릴 수 있으니
  // "배치"로 끊는 게 좋아요. 여기서는 한 번 실행에 최대 200회차만 추가.
  const MAX_ADD_PER_RUN = Number(process.env.MAX_ADD_PER_RUN || 200);

  let added = 0;
  let drwNo = start;

  while (added < MAX_ADD_PER_RUN) {
    const draw = await fetchDraw(drwNo);
    if (!draw) break; // 아직 발표 안 된 회차 or 잘못된 회차면 중단
    existing.set(draw.drwNo, draw);
    meta.latest_drwNo = Math.max(meta.latest_drwNo || 0, draw.drwNo);
    added += 1;
    drwNo += 1;
  }

  const merged = Array.from(existing.values()).sort((a, b) => a.drwNo - b.drwNo);
  writeJson(DRAWS_PATH, { draws: merged });

  meta.updated_at = nowIso();
  writeJson(META_PATH, meta);

  console.log(`Done. added=${added}, total=${merged.length}, latest=${meta.latest_drwNo}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
