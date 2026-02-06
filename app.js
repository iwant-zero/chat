// assets/app.js
const $ = (sel) => document.querySelector(sel);

const RANGE_CLASS = (n) => {
  if (n <= 10) return "c1";
  if (n <= 20) return "c2";
  if (n <= 30) return "c3";
  if (n <= 40) return "c4";
  return "c5";
};

function mulberry32(seed) {
  // 안정적인 의사난수(새로고침마다 다른 seed를 주면 세트가 바뀜)
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedSampleWithoutReplacement(items, weights, k, rnd) {
  // Efraimidis-Spirakis (A-ExpJ) 방식: 가중치 기반 비복원 추출
  // key = u^(1/w) 로 정렬 후 상위 k 선택
  const keyed = items.map((item, i) => {
    const w = Math.max(1e-9, weights[i]);
    const u = Math.max(1e-12, rnd());
    return { item, key: Math.pow(u, 1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, k).map(x => x.item);
}

function computeFreq(draws, includeBonus) {
  const freq = Array(46).fill(0);
  for (const d of draws) {
    for (const n of d.numbers) freq[n] += 1;
    if (includeBonus && d.bonus) freq[d.bonus] += 1;
  }
  return freq;
}

function buildTiers(freq) {
  const nums = [];
  for (let n = 1; n <= 45; n++) nums.push({ n, f: freq[n] });

  nums.sort((a, b) => b.f - a.f || a.n - b.n);

  // 상위/중위/하위: 45개를 3등분(15/15/15)
  const top = nums.slice(0, 15).map(x => x.n);
  const mid = nums.slice(15, 30).map(x => x.n);
  const low = nums.slice(30, 45).map(x => x.n);

  return { top, mid, low, ordered: nums.map(x => x.n) };
}

function explainSet(type) {
  switch (type) {
    case "상위 빈도":
      return "상위 빈도(자주 나온) 그룹에서 가중치(출현수) 기반으로 6개를 뽑습니다.";
    case "중위 빈도":
      return "중간 빈도 그룹에서 가중치 기반으로 6개를 뽑습니다. (너무 쏠림 방지)";
    case "하위 빈도":
      return "낮은 빈도 그룹에서 가중치 기반으로 6개를 뽑습니다. (역발상/분산)";
    case "구간 밸런스":
      return "1–10/11–20/21–30/31–40/41–45 구간을 섞어 뽑고, 각 구간 내에서는 빈도 가중치를 적용합니다.";
    case "혼합 가중":
      return "전체 1–45에서 빈도 가중치로 뽑습니다. 가장 ‘빈도 기반’ 느낌이 강한 세트입니다.";
    case "상·중 혼합":
      return "상위+중위 풀에서 가중치 기반으로 뽑습니다. 상위 편향을 완화한 실전형 조합.";
    case "중·하 혼합":
      return "중위+하위 풀에서 가중치 기반으로 뽑습니다. 변주를 크게 주는 타입.";
    default:
      return "출현 빈도 가중치로 비복원 추출해 6개를 생성합니다.";
  }
}

function makeSet(type, pools, freq, rnd, usedGlobal) {
  const pickFromPool = (poolNums, k) => {
    const items = poolNums.slice();
    const weights = items.map(n => freq[n] || 1);

    // 세트 간 중복 최소화(약): 이미 많이 쓴 숫자 가중치 살짝 낮춤
    const adjusted = items.map((n, i) => {
      const penalty = usedGlobal ? (1 / (1 + (usedGlobal.get(n) || 0) * 0.35)) : 1;
      return weights[i] * penalty;
    });

    return weightedSampleWithoutReplacement(items, adjusted, k, rnd);
  };

  let nums = [];

  if (type === "구간 밸런스") {
    // 구간별로 1~2개씩 뽑아서 6개 맞추기 (가중치 적용)
    const ranges = [
      { a: 1, b: 10, need: 1 },
      { a: 11, b: 20, need: 1 },
      { a: 21, b: 30, need: 1 },
      { a: 31, b: 40, need: 1 },
      { a: 41, b: 45, need: 1 },
    ];
    // 남은 1개는 랜덤 구간 추가(가중치: 구간 전체 빈도 합)
    const rangeScores = ranges.map(r => {
      let s = 0;
      for (let n = r.a; n <= r.b; n++) s += freq[n] || 1;
      return s;
    });
    const extraRange = weightedSampleWithoutReplacement(
      ranges.map((_, i) => i),
      rangeScores,
      1,
      rnd
    )[0];
    ranges[extraRange].need += 1;

    for (const r of ranges) {
      if (r.need <= 0) continue;
      const pool = [];
      for (let n = r.a; n <= r.b; n++) pool.push(n);
      nums.push(...pickFromPool(pool, r.need));
    }

  } else if (type === "상위 빈도") {
    nums = pickFromPool(pools.top, 6);

  } else if (type === "중위 빈도") {
    nums = pickFromPool(pools.mid, 6);

  } else if (type === "하위 빈도") {
    nums = pickFromPool(pools.low, 6);

  } else if (type === "상·중 혼합") {
    nums = pickFromPool([...pools.top, ...pools.mid], 6);

  } else if (type === "중·하 혼합") {
    nums = pickFromPool([...pools.mid, ...pools.low], 6);

  } else {
    // "혼합 가중": 전체에서
    const all = [];
    for (let n = 1; n <= 45; n++) all.push(n);
    nums = pickFromPool(all, 6);
  }

  nums = Array.from(new Set(nums)).sort((a, b) => a - b);

  // 혹시 중복 제거로 6개가 안 되면 보충(비복원)
  if (nums.length < 6) {
    const all = [];
    for (let n = 1; n <= 45; n++) if (!nums.includes(n)) all.push(n);
    const more = weightedSampleWithoutReplacement(
      all,
      all.map(n => (freq[n] || 1) * (usedGlobal ? (1 / (1 + (usedGlobal.get(n) || 0) * 0.35)) : 1)),
      6 - nums.length,
      rnd
    );
    nums = nums.concat(more).sort((a, b) => a - b);
  }

  return nums;
}

function planTypes(count) {
  // “여러 세트 랜덤”이 되도록 타입을 섞되, 구성은 고정 템플릿 + 일부 셔플
  const base = [
    "상위 빈도",
    "혼합 가중",
    "구간 밸런스",
    "상·중 혼합",
    "중위 빈도",
    "중·하 혼합",
    "하위 빈도",
    "혼합 가중",
    "구간 밸런스",
    "상위 빈도",
  ];

  const types = base.slice(0, Math.max(count, 5));
  // count가 5면 [0..4]까지, 10이면 [0..9]
  return types.slice(0, count);
}

function renderSetCard(idx, type, nums) {
  const balls = nums.map(n => `
    <div class="ball ${RANGE_CLASS(n)}" title="${n}">
      ${n}
    </div>
  `).join("");

  return `
    <div class="card">
      <div class="card-top">
        <div class="title">세트 ${idx + 1}</div>
        <div class="badge">${type}</div>
      </div>
      <div class="balls">${balls}</div>
      <div class="hint">${explainSet(type)}</div>
    </div>
  `;
}

let STATE = {
  draws: [],
  meta: null,
  freq: null,
  pools: null,
  lastCount: 5,
  lastSeed: null,
};

async function loadData() {
  const [drawsRes, metaRes] = await Promise.all([
    fetch("./data/lotto-draws.json", { cache: "no-store" }),
    fetch("./data/meta.json", { cache: "no-store" }),
  ]);
  const drawsJson = await drawsRes.json();
  const metaJson = await metaRes.json();

  STATE.draws = drawsJson.draws || [];
  STATE.meta = metaJson;

  $("#metaDraws").textContent = `${STATE.draws.length.toLocaleString()}회 누적`;
  $("#metaUpdated").textContent = (STATE.meta.updated_at || "-").replace("T", " ").replace("Z", " UTC");
}

function generate(count, seed) {
  const includeBonus = $("#chkIncludeBonus").checked;
  const uniqueBetweenSets = $("#chkUniqueBetweenSets").checked;

  const freq = computeFreq(STATE.draws, includeBonus);
  const pools = buildTiers(freq);

  // seed를 바꾸면 세트가 바뀜
  const rnd = mulberry32(seed);
  const usedGlobal = uniqueBetweenSets ? new Map() : null;

  const types = planTypes(count);

  // 타입 순서를 살짝 섞어 “여러 세트가 랜덤으로 나오게”
  // (단, 완전 랜덤이 아니라 seed 기반으로 결정)
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }

  const sets = types.map((type) => {
    const nums = makeSet(type, pools, freq, rnd, usedGlobal);
    if (usedGlobal) for (const n of nums) usedGlobal.set(n, (usedGlobal.get(n) || 0) + 1);
    return { type, nums };
  });

  const grid = $("#resultGrid");
  grid.innerHTML = sets.map((s, i) => renderSetCard(i, s.type, s.nums)).join("");

  STATE.lastCount = count;
  STATE.lastSeed = seed;
}

function newSeed() {
  // 시간 기반 + 약간 섞기
  const t = Date.now() & 0xffffffff;
  const extra = Math.floor(Math.random() * 0xffffffff);
  return (t ^ extra) >>> 0;
}

async function main() {
  await loadData();

  $("#btnGen5").addEventListener("click", () => generate(5, newSeed()));
  $("#btnGen10").addEventListener("click", () => generate(10, newSeed()));
  $("#btnReroll").addEventListener("click", () => generate(STATE.lastCount, newSeed()));

  // 최초 자동 생성
  generate(5, newSeed());
}

main().catch((e) => {
  console.error(e);
  $("#resultGrid").innerHTML = `
    <div class="card">
      <div class="title">데이터 로드 실패</div>
      <div class="hint">data/lotto-draws.json, data/meta.json을 확인하세요.</div>
    </div>
  `;
});
