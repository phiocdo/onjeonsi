/**
 * 한국문화정보원 "한눈에보는문화정보" API로 manual.json 보충 후보를 뽑는다(반자동).
 * 출처 표기: 한국문화정보원 한눈에보는문화정보 (이용허락범위 제한 없음)
 *
 * - 결과는 review/kcisa/에만 쓴다(candidates.md, candidates.json, manual-draft.json). data/는 쓰지 않는다.
 *   사람이 후보를 확인해 data/exhibitions/manual.json에 옮긴다.
 * - 키는 환경 변수 KCISA_API_KEY에서만 읽는다(.env를 읽지 않는다). 키는 출력하지 않는다.
 *
 * 실행:
 *   PowerShell:  $env:KCISA_API_KEY = "<발급받은 키>"; npx tsx scripts/fetch-kcisa-candidates.ts
 *   오프라인:    npx tsx scripts/fetch-kcisa-candidates.ts --offline
 *                (review/kcisa/realm2-box*.xml, detail2-sample.xml로 같은 처리 → review/kcisa/offline/)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Exhibition, Venue } from '../src/types/index.ts';
import type { VenueLinks } from '../src/engine/matchVenue.ts';
import {
  CATEGORY_LABEL,
  classify,
  detailMismatches,
  parseKcisaXml,
  renderCandidatesMarkdown,
  toCandidate,
  toManualDraft,
  type Classified,
  type KcisaCategory,
  type KcisaResponse,
} from './kcisa.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REVIEW_DIR = path.join(ROOT, 'review', 'kcisa');

const BASE_URL = 'https://apis.data.go.kr/B553457/cultureinfo';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const DELAY_MS = 300;
const DAILY_LIMIT = 10000;
// 종로구·중구를 넉넉히 덮는 좌표 범위. 구는 sigungu로 다시 거른다
const BOX = { gpsxfrom: '126.94', gpsxto: '127.03', gpsyfrom: '37.54', gpsyto: '37.64' };

const offline = process.argv.includes('--offline');
const OUT_DIR = offline ? path.join(REVIEW_DIR, 'offline') : REVIEW_DIR;

function readJson<T>(relative: string): T {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf-8')) as T;
}

function loadContext() {
  const venueDir = path.join(ROOT, 'data', 'venues');
  const venues = fs
    .readdirSync(venueDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => readJson<Venue>(`data/venues/${name}`));
  const linksPath = path.join(ROOT, 'data', 'venue-links.json');
  const links = fs.existsSync(linksPath) ? readJson<VenueLinks>('data/venue-links.json') : {};
  // auto.json에는 lat: null이 있어 Exhibition과 정확히 맞지 않는다(matchVenue가 숫자인지 다시 본다)
  const auto = readJson<Exhibition[]>('data/exhibitions/auto.json');
  const manual = readJson<Exhibition[]>('data/exhibitions/manual.json');
  return { venues, links, auto, manual };
}

/** 서울 날짜 YYYY-MM-DD */
function seoulToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** YYYY-MM-DD에 years년을 더한 YYYYMMDD (2월 29일은 2월 28일로) */
function shiftYears(isoDate: string, years: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y + years, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10).replace(/-/g, '');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 출력용: serviceKey 값을 가린다 */
const maskKey = (text: string) => text.replace(/(serviceKey=)[^&\s]*/gi, '$1***');

// ---------------------------------------------------------------------------
// 네트워크 모드

let calls = 0;

async function callApi(endpoint: string, params: Record<string, string>, apiKey: string): Promise<KcisaResponse> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set('serviceKey', apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  calls++;
  console.log(`   → ${maskKey(url.toString())}`);
  let res: Response;
  try {
    res = await fetch(url);
  } catch (error) {
    // 출력은 message만 한다(main의 catch). cause는 출력하지 않는다
    throw new Error(`요청 실패: ${maskKey(String((error as Error).message ?? error))}`, { cause: error });
  }
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${maskKey(body.slice(0, 200))}`);
  const parsed = parseKcisaXml(body);
  if (!parsed.ok) {
    throw new Error(`오류 응답 (${parsed.header.resultCode || '코드 없음'}): ${maskKey(parsed.header.resultMsg)}`);
  }
  return parsed;
}

async function fetchListItems(apiKey: string, today: string): Promise<Record<string, string>[]> {
  const base = {
    sido: '서울',
    realmCode: 'D000',
    serviceTp: 'A',
    from: shiftYears(today, -1),
    to: shiftYears(today, 1),
    numOfrows: String(PAGE_SIZE),
    ...BOX,
  };
  const items: Record<string, string>[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    if (page > 1) await sleep(DELAY_MS);
    const res = await callApi('realm2', { ...base, PageNo: String(page) }, apiKey);
    items.push(...res.items);
    if (page === 1) {
      const total = res.totalCount ?? res.items.length;
      totalPages = Math.ceil(total / PAGE_SIZE);
      console.log(`   totalCount ${total} → ${totalPages}페이지`);
      if (totalPages > MAX_PAGES) {
        console.warn(`⚠️ ${totalPages}페이지라 안전장치(${MAX_PAGES}페이지)까지만 받습니다`);
        totalPages = MAX_PAGES;
      }
    }
    if (!res.items.length) break;
  }
  return items;
}

// ---------------------------------------------------------------------------
// 오프라인 모드

function readOfflineList(): Record<string, string>[] {
  const pageOf = (name: string) => Number(name.match(/-p(\d+)\.xml$/)?.[1] ?? 1);
  const files = fs
    .readdirSync(REVIEW_DIR)
    .filter((name) => /^realm2-box(-p\d+)?\.xml$/.test(name))
    .sort((a, b) => pageOf(a) - pageOf(b));
  const items: Record<string, string>[] = [];
  for (const name of files) {
    const res = parseKcisaXml(fs.readFileSync(path.join(REVIEW_DIR, name), 'utf-8'));
    if (!res.ok) throw new Error(`${name}: ${res.header.resultMsg}`);
    console.log(`   ${name}: ${res.items.length}건 (totalCount ${res.totalCount ?? '?'})`);
    items.push(...res.items);
  }
  return items;
}

function readOfflineDetails(): Map<string, Record<string, string>> {
  const details = new Map<string, Record<string, string>>();
  const file = path.join(REVIEW_DIR, 'detail2-sample.xml');
  if (!fs.existsSync(file)) return details;
  const res = parseKcisaXml(fs.readFileSync(file, 'utf-8'));
  if (!res.ok) throw new Error(`detail2-sample.xml: ${res.header.resultMsg}`);
  for (const item of res.items) if (item.seq) details.set(item.seq, item);
  return details;
}

// ---------------------------------------------------------------------------

function dedupeBySeq(items: Record<string, string>[]): Record<string, string>[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const seq = (item.seq ?? '').trim();
    if (!seq || seen.has(seq)) return false;
    seen.add(seq);
    return true;
  });
}

async function main() {
  const apiKey = process.env.KCISA_API_KEY?.trim();
  if (!offline && !apiKey) {
    console.error('❌ KCISA_API_KEY가 설정되지 않았습니다.');
    console.error('   PowerShell: $env:KCISA_API_KEY = "<발급받은 키>"; npx tsx scripts/fetch-kcisa-candidates.ts');
    console.error('   네트워크 없이 샘플로 돌리려면 --offline');
    process.exit(1);
  }
  // 공공데이터포털은 인코딩된 키와 디코딩된 키를 함께 준다. 인코딩된 키면 풀어서 한 번만 인코딩되게 한다
  const key = apiKey && apiKey.includes('%') ? decodeURIComponent(apiKey) : apiKey;

  const today = seoulToday();
  const ctx = { ...loadContext(), today };
  console.log(`📥 한국문화정보원 한눈에보는문화정보 후보 찾기 (${offline ? '오프라인' : '네트워크'}, 기준 ${today})`);

  const listItems = dedupeBySeq(offline ? readOfflineList() : await fetchListItems(key!, today));
  console.log(`   목록 ${listItems.length}건`);

  // 1차 분류(목록만). 추가 후보에 대해서만 상세를 본다
  const firstPass = classify(listItems.map((item) => toCandidate(item)), ctx);
  const addSeqs = firstPass.filter((r) => r.category === 'add').map((r) => r.candidate.seq);

  const details = offline ? readOfflineDetails() : new Map<string, Record<string, string>>();
  if (!offline) {
    for (const [i, seq] of addSeqs.entries()) {
      if (i > 0) await sleep(DELAY_MS);
      const res = await callApi('detail2', { seq }, key!);
      if (res.items[0]) details.set(seq, res.items[0]);
    }
  }

  const warnings: string[] = [];
  const listBySeq = new Map(listItems.map((item) => [item.seq.trim(), item]));
  const results: Classified[] = firstPass.map((r) => {
    if (r.category !== 'add') return r;
    const listItem = listBySeq.get(r.candidate.seq)!;
    const detail = details.get(r.candidate.seq);
    if (!detail) return r;
    for (const w of detailMismatches(listItem, detail)) warnings.push(`seq ${r.candidate.seq}: ${w}`);
    return { ...r, candidate: toCandidate(listItem, detail) };
  });
  const missingDetail = results.filter((r) => r.category === 'add' && !r.candidate.hasDetail).length;
  if (missingDetail) warnings.push(`추가 후보 중 상세가 없는 ${missingDetail}건은 링크·요금·주소가 비어 있습니다`);

  const venueById = new Map(ctx.venues.map((v) => [v.id, v]));
  const fetchedAt = offline ? undefined : new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const drafts = results
    .filter((r) => r.category === 'add' && r.venueId)
    .map((r) => toManualDraft(r.candidate, venueById.get(r.venueId!)!, fetchedAt));

  const generatedAt = new Date().toISOString();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'candidates.md'),
    renderCandidatesMarkdown(results, { generatedAt, today, mode: offline ? 'offline' : 'network', calls, warnings }),
  );
  fs.writeFileSync(
    path.join(OUT_DIR, 'candidates.json'),
    JSON.stringify({ source: '한국문화정보원 한눈에보는문화정보', generatedAt, today, results }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(OUT_DIR, 'manual-draft.json'), JSON.stringify(drafts, null, 2) + '\n');

  const order: KcisaCategory[] = ['add', 'existing', 'unlinked', 'excluded'];
  console.log(`\n📊 ${order.map((c) => `${CATEGORY_LABEL[c]} ${results.filter((r) => r.category === c).length}`).join(' / ')}`);
  for (const w of warnings) console.warn(`⚠️ ${w}`);
  console.log(`📝 ${path.relative(ROOT, OUT_DIR)}/ 에 candidates.md, candidates.json, manual-draft.json(${drafts.length}건)`);
  console.log(`📞 API 호출 ${calls}회 (일일 한도 ${DAILY_LIMIT})`);
}

main().catch((error) => {
  console.error(`❌ ${maskKey(String((error as Error).message ?? error))}`);
  console.error(`   API 호출 ${calls}회`);
  process.exit(1);
});
