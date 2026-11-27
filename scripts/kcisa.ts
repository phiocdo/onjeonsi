/**
 * 한국문화정보원 "한눈에보는문화정보" API(B553457/cultureinfo)를 읽는 순수 함수.
 * 출처 표기: 한국문화정보원 한눈에보는문화정보 (이용허락범위 제한 없음)
 *
 * 이 API는 manual.json 보충 후보를 찾는 데만 쓴다. 자동 수집하지 않는다.
 * - 운영시간·휴관·입장 마감을 주지 않는다. 그래서 우리 시설(data/venues)에 연결되는 전시만 후보로 삼고,
 *   초안의 운영시간은 연결 시설의 hours를 옮긴 시작점이다. 사람이 공식 사이트에서 확인해 고친다.
 * - 우선순위: 서울시 auto.json > manual.json > 이 API. 같은 전시 판정은 manualExhibitions.ts의 sameExhibition.
 *
 * 파일·네트워크를 건드리지 않는다. 실행은 fetch-kcisa-candidates.ts.
 */
import type { DaySchedule, Exhibition, ParsedOperatingHours, Venue, Weekday } from '../src/types/index.ts';
import { matchVenue, type VenueLinks } from '../src/engine/matchVenue.ts';
import { normalizeTitle, sameExhibition } from '../src/lib/manualExhibitions.ts';
import { parseFee } from './exhibition-fee.ts';

// ---------------------------------------------------------------------------
// XML

export interface KcisaResponse {
  ok: boolean;
  header: { resultCode: string; resultMsg: string };
  totalCount?: number;
  items: Record<string, string>[];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  times: '×',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
  bull: '•',
  laquo: '«',
  raquo: '»',
  lang: '〈',
  rang: '〉',
};

function decodeOnce(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * 엔티티를 풀되, 결과가 더 바뀌지 않을 때까지 최대 3번 되풀이한다.
 * API가 '&amp;lt;선율&amp;gt;'처럼 두 번 이스케이프해 보내기 때문이다(XML 한 번 + HTML 한 번).
 * 모르는 이름의 엔티티는 그대로 둔다.
 */
export function decodeEntities(text: string): string {
  let current = text;
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

/** 태그 안 값: CDATA는 벗기고, 줄바꿈을 \n으로 맞추고, 엔티티를 풀고, 앞뒤 공백을 지운다 */
function readValue(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(unwrapped.replace(/\r\n?/g, '\n')).trim();
}

/** 평평한 자식 태그를 { 이름: 값 }으로 읽는다. 빈 태그(<a/>, <a></a>)는 '' */
function readFlatTags(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const tag = /<([A-Za-z_][\w.-]*)(?:\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/\1\s*>)/g;
  for (const m of block.matchAll(tag)) out[m[1]] = m[2] === undefined ? '' : readValue(m[2]);
  return out;
}

function firstBlock(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`));
  return m ? m[1] : null;
}

function firstValue(xml: string, name: string): string | undefined {
  const block = firstBlock(xml, name);
  return block === null ? undefined : readValue(block);
}

/**
 * 목록(realm2)·상세(detail2) 응답 XML을 읽는다. 의존성 없는 단순 파서라 <item> 안의 평평한 태그만 본다.
 * - 공공데이터포털 공통 오류(OpenAPI_ServiceResponse / cmmMsgHeader)면 ok: false와 그 메시지
 * - header의 resultCode가 '00'이 아니거나 header가 없으면 ok: false
 */
export function parseKcisaXml(xml: string): KcisaResponse {
  const raw = xml ?? '';
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // BOM

  const cmm = firstBlock(text, 'cmmMsgHeader');
  if (cmm !== null || /<OpenAPI_ServiceResponse\b/.test(text)) {
    const tags = readFlatTags(cmm ?? text);
    const msg = [tags.errMsg, tags.returnAuthMsg].filter(Boolean).join(' / ') || 'OpenAPI 오류 응답';
    return { ok: false, header: { resultCode: tags.returnReasonCode ?? '', resultMsg: msg }, items: [] };
  }

  const headerBlock = firstBlock(text, 'header');
  if (headerBlock === null) {
    const preview = text.trim().slice(0, 80);
    return { ok: false, header: { resultCode: '', resultMsg: `header가 없는 응답입니다: ${preview}` }, items: [] };
  }
  const header = readFlatTags(headerBlock);
  const resultCode = header.resultCode ?? '';
  const resultMsg = header.resultMsg ?? '';

  const body = firstBlock(text, 'body') ?? '';
  const totalText = firstValue(body, 'totalCount');
  const total = totalText === undefined || totalText === '' ? undefined : Number(totalText);
  const items = [...body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/g)].map((m) => readFlatTags(m[1]));

  return {
    ok: resultCode === '00',
    header: { resultCode, resultMsg },
    ...(total !== undefined && Number.isFinite(total) ? { totalCount: total } : {}),
    items,
  };
}

// ---------------------------------------------------------------------------
// 요금

/**
 * 상세의 price 문구를 isFree·fee로 옮긴다. fee는 앞뒤 공백을 지운 원문(FEE_MAX자 규칙은 exhibition-fee.ts).
 * - 정확히 '무료' → isFree: true
 * - 금액(숫자+'원')이 있고 '무료'라는 말이 없음 → isFree: false
 * - 그 밖('무료(일부 유료)', '현장 문의' 등) → isFree 없이 fee만. 빈 값이면 둘 다 없음
 */
export function parseKcisaPrice(price: string | undefined): { isFree?: boolean; fee?: string } {
  const text = (price ?? '').trim();
  const { fee } = parseFee(undefined, text);
  if (fee === undefined) return {};
  if (text === '무료') return { isFree: true, fee };
  if (/\d\s*원/.test(text) && !text.includes('무료')) return { isFree: false, fee };
  return { fee };
}

// ---------------------------------------------------------------------------
// 후보

export interface KcisaCandidate {
  seq: string;
  title: string;
  /** YYYY-MM-DD. 원문이 날짜가 아니면 '' */
  start: string;
  end: string;
  placeName: string;
  sigungu: string;
  /** realmName (serviceName이 아니라 이 값으로 분야를 본다) */
  realm: string;
  serviceName: string;
  /** gpsY. 없거나 서울 범위 밖이면 null */
  lat: number | null;
  /** gpsX */
  lng: number | null;
  imageUrl?: string;
  /** 상세 url (전시 상세 페이지) */
  link?: string;
  /** 상세 placeAddr */
  address?: string;
  /** 상세 placeUrl (시설 페이지) */
  placeUrl?: string;
  isFree?: boolean;
  fee?: string;
  /** 상세를 받아 보충했는지 */
  hasDetail: boolean;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'. 달력에 없는 날짜면 '' */
export function toIsoDate(raw: string | undefined): string {
  const m = (raw ?? '').trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return '';
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return '';
  return `${y}-${mo}-${d}`;
}

// 서울 범위. schema/exhibitions.schema.json과 같은 값
const SEOUL_LAT: [number, number] = [37.4, 37.7];
const SEOUL_LNG: [number, number] = [126.7, 127.3];

function toCoord(raw: string | undefined, [lo, hi]: [number, number]): number | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
}

function httpUrl(raw: string | undefined): string | undefined {
  const text = (raw ?? '').trim();
  return /^https?:\/\/\S/.test(text) ? text : undefined;
}

const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** 목록 item(+ 상세 item)을 후보로 바꾼다. 기본 필드는 목록 값을 쓰고, 목록에 없으면 상세 값을 쓴다 */
export function toCandidate(listItem: Record<string, string>, detailItem?: Record<string, string>): KcisaCandidate {
  const d = detailItem ?? {};
  const pick = (key: string) => (listItem[key] ?? '').trim() || (d[key] ?? '').trim();
  const lat = toCoord(pick('gpsY'), SEOUL_LAT);
  const lng = toCoord(pick('gpsX'), SEOUL_LNG);
  const bothCoords = lat !== null && lng !== null;

  const imageUrl = httpUrl(d.imgUrl) ?? httpUrl(listItem.thumbnail);
  const link = httpUrl(d.url);
  const placeUrl = httpUrl(d.placeUrl);
  const address = oneLine(d.placeAddr) || undefined;
  const price = detailItem ? parseKcisaPrice(d.price) : {};

  return {
    seq: pick('seq'),
    title: oneLine(pick('title')),
    start: toIsoDate(pick('startDate')),
    end: toIsoDate(pick('endDate')),
    placeName: oneLine(pick('place')),
    sigungu: pick('sigungu'),
    realm: pick('realmName'),
    serviceName: pick('serviceName'),
    lat: bothCoords ? lat : null,
    lng: bothCoords ? lng : null,
    ...(imageUrl ? { imageUrl } : {}),
    ...(link ? { link } : {}),
    ...(address ? { address } : {}),
    ...(placeUrl ? { placeUrl } : {}),
    ...price,
    hasDetail: detailItem !== undefined,
  };
}

/** 상세의 sigungu·placeAddr가 목록과 어긋나면 경고 문구를 돌려준다 */
export function detailMismatches(listItem: Record<string, string>, detailItem: Record<string, string>): string[] {
  const warnings: string[] = [];
  const listGu = (listItem.sigungu ?? '').trim();
  const detailGu = (detailItem.sigungu ?? '').trim();
  if (detailGu && listGu !== detailGu) warnings.push(`sigungu가 다릅니다: 목록 '${listGu}' / 상세 '${detailGu}'`);
  const addr = oneLine(detailItem.placeAddr);
  if (addr && listGu && !addr.includes(listGu)) warnings.push(`placeAddr에 목록 구('${listGu}')가 없습니다: '${addr}'`);
  return warnings;
}

// ---------------------------------------------------------------------------
// 분류

export const TARGET_GU = ['종로구', '중구'] as const;

export type KcisaCategory = 'add' | 'existing' | 'unlinked' | 'excluded';

export const CATEGORY_LABEL: Record<KcisaCategory, string> = {
  add: '추가 후보',
  existing: '이미 있음',
  unlinked: '제외(시설 미연결)',
  excluded: '제외(구 밖·끝남·전시 아님)',
};

/**
 * 전시가 아닌 프로그램으로 보는 제목 낱말. 제목 원문에서 대소문자·공백을 무시하고 찾는다.
 * #81에서 MMCA 다원예술·필름앤비디오 같은 상영·공연 프로그램을 일부러 뺐다.
 * 회차로 진행해 운영시간 내내 '가능'으로 나오면 틀리기 때문이다.
 * '공연'은 넣지 않는다. "공연장으로 간 미술"(333675)처럼 실제 전시가 제목 때문에 빠질 수 있다.
 */
export const NON_EXHIBITION_TITLE_WORDS = ['필름앤비디오', '다원예술', '상영'] as const;

const compact = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** 제목에 상영·공연 프로그램 낱말이 있으면 그 낱말 */
export function nonExhibitionWord(title: string): string | undefined {
  const t = compact(title);
  return NON_EXHIBITION_TITLE_WORDS.find((word) => t.includes(compact(word)));
}

/** 제목 포함 일치에서 짧은 쪽 제목이 이 글자 수 이상이어야 한다 */
export const TITLE_CONTAINS_MIN = 4;

/**
 * 제목 포함 일치에 쓰는 정규화 제목들(normalizeTitle).
 * normalizeTitle은 [대괄호] 안을 통째로 지우는데, 서울시 제목은
 * "[서울공예박물관] 현대공예 기증특별전 [에퀴녹스 : 추분_춘분]"처럼 진짜 제목을 대괄호에 넣기도 한다.
 * 그래서 대괄호 안을 지운 것, 대괄호 글자만 지운 것, 대괄호 안 내용 하나하나를 함께 본다.
 */
export function titleForms(title: string): { whole: string[]; segments: string[] } {
  const whole = [normalizeTitle(title), normalizeTitle(title.replace(/[[\]]/g, ' '))];
  const segments = [...title.matchAll(/\[([^\]]*)\]/g)].map((m) => normalizeTitle(m[1]));
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  return { whole: uniq(whole), segments: uniq(segments) };
}

/**
 * 두 제목이 "포함 일치"인지 본다.
 * - 짧은 쪽이 TITLE_CONTAINS_MIN자 이상이고 긴 쪽에 들어 있다
 * - 또는 한쪽 제목 전체가 다른 쪽의 [대괄호] 안 내용과 정확히 같다(2자 이상. 예: 《오윤》 ↔ "… 기획전 [오윤]")
 */
export function titleContains(a: string, b: string): boolean {
  const fa = titleForms(a);
  const fb = titleForms(b);
  for (const x of fa.whole) {
    for (const y of fb.whole) {
      const [short, long] = x.length <= y.length ? [x, y] : [y, x];
      if (short.length >= TITLE_CONTAINS_MIN && long.includes(short)) return true;
    }
  }
  const exactSegment = (wholes: string[], segments: string[]) =>
    wholes.some((w) => w.length >= 2 && segments.includes(w));
  return exactSegment(fa.whole, fb.segments) || exactSegment(fb.whole, fa.segments);
}

/**
 * 후보 전용 같은 전시 판정. 화면 카탈로그가 쓰는 sameExhibition은 바꾸지 않는다.
 * - sameExhibition이 true면 'exact'
 * - 아니면 같은 시설(둘 다 연결되고 venueId가 같음) + 기간 겹침 + 제목 포함 일치면 'title-contains'
 * - 그 밖은 null
 */
export function sameCandidateExhibition(
  a: Exhibition,
  b: Exhibition,
  venueIdOf: (exhibition: Exhibition) => string | null,
): 'exact' | 'title-contains' | null {
  if (sameExhibition(a, b, venueIdOf)) return 'exact';
  if (a.start > b.end || b.start > a.end) return null;
  const venueA = venueIdOf(a);
  if (venueA === null || venueA !== venueIdOf(b)) return null;
  return titleContains(a.title, b.title) ? 'title-contains' : null;
}

export interface Classified {
  candidate: KcisaCandidate;
  category: KcisaCategory;
  reason: string;
  venueId?: string;
  venueName?: string;
  matchedBy?: 'link' | 'alias' | 'coord';
  sameAs?: { source: 'auto' | 'manual'; id: string; title: string; by: 'id' | 'exact' | 'title-contains' };
}

export interface ClassifyContext {
  auto: readonly Exhibition[];
  manual: readonly Exhibition[];
  venues: readonly Venue[];
  links: VenueLinks;
  /** YYYY-MM-DD (서울 날짜) */
  today: string;
}

export const manualIdOf = (seq: string) => `manual-kcisa-${seq}`;

/** sameExhibition·matchVenue에 넘기려고 후보를 전시 모양으로 만든다 */
function asExhibition(c: KcisaCandidate): Exhibition {
  return {
    id: `kcisa-${c.seq}`,
    venueId: '',
    title: c.title,
    start: c.start,
    end: c.end,
    placeName: c.placeName,
    ...(c.lat !== null && c.lng !== null ? { lat: c.lat, lng: c.lng } : {}),
  };
}

/**
 * 후보마다 분류와 사유를 붙인다. 보는 순서:
 * 1. 날짜 형식 오류 / 전시 아님(realmName, 상영·공연 프로그램 제목) / 구 밖(sigungu) / 끝남(end < today) → excluded
 * 2. auto.json에 같은 전시 → existing, 그다음 manual.json(id가 manual-kcisa-{seq}이거나 같은 전시) → existing
 *    같은 전시는 sameCandidateExhibition(정확히 같음, 아니면 같은 시설·기간 겹침·제목 포함 일치)
 * 3. 시설에 연결되지 않음(matchVenue) → unlinked
 * 4. 나머지 → add
 */
export function classify(candidates: readonly KcisaCandidate[], ctx: ClassifyContext): Classified[] {
  const venueIdOf = (e: Exhibition) => matchVenue(e, ctx.venues, ctx.links).venueId;
  const venueById = new Map(ctx.venues.map((v) => [v.id, v]));

  return candidates.map((candidate): Classified => {
    const base = { candidate };
    if (!candidate.start || !candidate.end) return { ...base, category: 'excluded', reason: '날짜 형식 오류' };
    if (candidate.realm !== '전시') {
      return { ...base, category: 'excluded', reason: `전시 아님(realmName '${candidate.realm}')` };
    }
    const word = nonExhibitionWord(candidate.title);
    if (word) return { ...base, category: 'excluded', reason: `전시 아님(상영·공연 프로그램: '${word}')` };
    if (!(TARGET_GU as readonly string[]).includes(candidate.sigungu)) {
      return { ...base, category: 'excluded', reason: `구 밖(${candidate.sigungu || '구 없음'})` };
    }
    if (candidate.end < ctx.today) return { ...base, category: 'excluded', reason: `끝남(${candidate.end})` };

    const ex = asExhibition(candidate);
    const match = matchVenue(ex, ctx.venues, ctx.links);
    const venue = match.venueId ? venueById.get(match.venueId) : undefined;
    const linked = venue
      ? { venueId: venue.id, venueName: venue.name, ...(match.by ? { matchedBy: match.by } : {}) }
      : {};

    const manualId = manualIdOf(candidate.seq);
    const findSame = (list: readonly Exhibition[], source: 'auto' | 'manual'): Classified | null => {
      let found: { other: Exhibition; by: 'id' | 'exact' | 'title-contains' } | null = null;
      const byId = source === 'manual' ? list.find((other) => other.id === manualId) : undefined;
      if (byId) found = { other: byId, by: 'id' };
      // 정확히 같은 전시를 먼저 찾고, 없을 때만 제목 포함 일치를 본다
      for (const want of ['exact', 'title-contains'] as const) {
        if (found) break;
        const other = list.find((o) => sameCandidateExhibition(o, ex, venueIdOf) === want);
        if (other) found = { other, by: want };
      }
      if (!found) return null;
      const { other, by } = found;
      return {
        ...base,
        ...linked,
        category: 'existing',
        reason: `${source}.json의 ${other.id}와 같은 전시${by === 'title-contains' ? '(제목 포함 일치)' : ''}`,
        sameAs: { source, id: other.id, title: other.title, by },
      };
    };
    const existing = findSame(ctx.auto, 'auto') ?? findSame(ctx.manual, 'manual');
    if (existing) return existing;

    if (!venue) return { ...base, category: 'unlinked', reason: '시설 미연결' };
    return { ...base, ...linked, category: 'add', reason: `시설 연결(${match.by})` };
  });
}

// ---------------------------------------------------------------------------
// manual.json 초안

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** 시설 hours를 요일별로 옮긴다. hours가 없는 요일은 닫힘. 여는 요일이 하나도 없으면 'unknown' */
export function hoursFromVenue(venue: Venue): ParsedOperatingHours {
  const weekdays = {} as Record<Weekday, DaySchedule>;
  for (const day of WEEKDAYS) {
    const h = venue.hours?.[day];
    weekdays[day] = h ? { isOpen: true, intervals: [{ open: h.open, close: h.close }] } : { isOpen: false, intervals: [] };
  }
  const anyOpen = WEEKDAYS.some((day) => weekdays[day].isOpen);
  return { scheduleType: anyOpen ? 'scheduled' : 'unknown', weekdays, holiday: null, exceptions: [] };
}

/**
 * manual.json 항목 초안. 기존 manual.json 관례를 따른다.
 * - id 'manual-kcisa-{seq}', venueId '', field '전시/미술'(서울시 API 전시 분류와 같은 값), hoursText ''
 * - link는 시설 페이지(placeUrl), detailUrl은 전시 상세 페이지(상세 url)
 * - operatingHours는 연결 시설 hours를 옮긴 시작점. 사람이 공식 사이트에서 확인해 고친다
 */
export function toManualDraft(candidate: KcisaCandidate, venue: Venue, fetchedAt?: string): Exhibition {
  return {
    id: manualIdOf(candidate.seq),
    venueId: '',
    title: candidate.title,
    start: candidate.start,
    end: candidate.end,
    field: '전시/미술',
    placeName: candidate.placeName,
    hoursText: '',
    operatingHours: hoursFromVenue(venue),
    ...(candidate.placeUrl ? { link: candidate.placeUrl } : {}),
    ...(candidate.imageUrl ? { imageUrl: candidate.imageUrl } : {}),
    ...(candidate.link ? { detailUrl: candidate.link } : {}),
    ...(candidate.lat !== null && candidate.lng !== null ? { lat: candidate.lat, lng: candidate.lng } : {}),
    ...(candidate.isFree !== undefined ? { isFree: candidate.isFree } : {}),
    ...(candidate.fee !== undefined ? { fee: candidate.fee } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// 후보 문서

const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function feeCell(c: KcisaCandidate): string {
  if (!c.hasDetail) return '(상세 없음)';
  const flag = c.isFree === true ? '무료' : c.isFree === false ? '유료' : '';
  const fee = c.fee && c.fee !== flag ? c.fee : '';
  return [flag, fee].filter(Boolean).join(' · ') || '-';
}

export interface ReportMeta {
  generatedAt: string;
  today: string;
  mode: 'network' | 'offline';
  calls: number;
  warnings: readonly string[];
}

export function renderCandidatesMarkdown(results: readonly Classified[], meta: ReportMeta): string {
  const order: KcisaCategory[] = ['add', 'existing', 'unlinked', 'excluded'];
  const count = (cat: KcisaCategory) => results.filter((r) => r.category === cat).length;
  const lines: string[] = [
    '# 한국문화정보원 manual.json 보충 후보',
    '',
    '출처: 한국문화정보원 한눈에보는문화정보 (이용허락범위 제한 없음)',
    '',
    `- 만든 시각: ${meta.generatedAt} (${meta.mode === 'offline' ? '오프라인: review/kcisa 샘플' : '네트워크'})`,
    `- 기준 날짜(서울): ${meta.today}`,
    `- API 호출: ${meta.calls}회`,
    `- 전체 ${results.length}건: ${order.map((c) => `${CATEGORY_LABEL[c]} ${count(c)}`).join(' / ')}`,
    '',
    '> **추가 후보를 manual.json에 옮기기 전에 운영시간·휴관·입장 마감을 공식 사이트에서 확인해야 합니다.**',
    '> 이 API는 운영시간을 주지 않습니다. manual-draft.json의 operatingHours는 연결 시설 hours를 옮긴 시작점이고,',
    '> hoursText는 비어 있습니다. 휴관일은 exceptions에 날짜별로 씁니다. 기간·요금·링크도 공식 사이트와 맞춰 봅니다.',
    '',
  ];
  if (meta.warnings.length) {
    lines.push('## 경고', '', ...meta.warnings.map((w) => `- ${w}`), '');
  }
  for (const cat of order) {
    const rows = results.filter((r) => r.category === cat);
    lines.push(`## ${CATEGORY_LABEL[cat]} (${rows.length})`, '');
    if (!rows.length) {
      lines.push('(없음)', '');
      continue;
    }
    lines.push('| seq | 제목 | 기간 | 장소 | 구 | 연결 시설 | 같은 전시 id | 요금 | 링크 | 사유 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      const c = r.candidate;
      lines.push(
        `| ${[
          c.seq,
          c.title,
          `${c.start}~${c.end}`,
          c.placeName,
          c.sigungu,
          r.venueId ?? '',
          r.sameAs?.id ?? '',
          feeCell(c),
          c.link ? `[상세](${c.link})` : '',
          r.reason,
        ]
          .map(cell)
          .join(' | ')} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
