/**
 * 아카이브(관람 기록) 읽기·저장·내보내기·가져오기·삭제.
 *
 * - 저장소는 인자로 받는다. 화면은 localStorage를, 테스트는 메모리 저장소를 넘긴다.
 * - 저장 키는 ARCHIVE_KEY 하나다. 예전 화면은 키 두 개(기록, 관심 분야)에 v1 형식으로 저장했고,
 *   loadArchive가 처음 읽을 때 v2로 옮긴다. v1 키는 새 키 저장에 성공했을 때 지운다.
 * - 잘못된 기록(형식이 다르거나 별점·관람 시간이 범위를 벗어난 것)은 읽을 때 버린다.
 *   화면 입력으로는 만들 수 없는 값이라 저장소를 직접 고친 경우에만 생긴다.
 * - 읽을 때 카탈로그에 전시가 있으면 전시 정보 사본을 최신으로 고친다. 그래서 화면과 내보내기가 같다.
 * - 사용자 태그(tags)는 선택 필드다. 태그가 있을 때만 필드를 두므로 ARCHIVE_VERSION은 2 그대로다
 *   (태그를 모르는 예전 화면도 v2로 읽고, 태그만 무시한다).
 */
import { isValidReview } from '../engine/stats';
import {
  ARCHIVE_VERSION,
  type ArchiveData,
  type ArchiveExport,
  type ExhibitionSnapshot,
  type VisitRecord,
} from '../types/records';
import { displayVenueName, todayInSeoul, type CatalogEntry } from './catalog';
import { TAGS } from './tags';
import { normalizeTags } from './userTags';

export const ARCHIVE_KEY = 'onjeonsi:archive';
/** v1 화면이 쓰던 키. 옮긴 뒤 지운다 */
export const LEGACY_RECORDS_KEY = 'onjeonsi:archive:records';
export const LEGACY_INTERESTS_KEY = 'onjeonsi:archive:interests';

/** 카탈로그에 없는 전시를 옮길 때 쓰는 제목 */
export const UNKNOWN_TITLE = '알 수 없는 전시';

export type ArchiveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 전시 id로 카탈로그 항목을 찾는 함수 */
export type CatalogLookup = (exhibitionId: string) => CatalogEntry | undefined;

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** YYYY-MM-DD 형식이고 달력에 있는 날짜인지 (2026-02-30 같은 날은 거짓) */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function emptyArchive(): ArchiveData {
  return { version: ARCHIVE_VERSION, records: [], interests: [] };
}

// ─── 기록 만들기 ────────────────────────────────────────────

/** 카탈로그 항목에서 전시 정보 사본을 만든다 */
export function snapshotOf(entry: CatalogEntry): ExhibitionSnapshot {
  const { exhibition } = entry;
  return {
    title: exhibition.title,
    venueName: displayVenueName(entry) || null,
    venueId: entry.venue?.id ?? null,
    field: exhibition.field || null,
    imageUrl: exhibition.imageUrl || null,
    start: isCalendarDate(exhibition.start) ? exhibition.start : null,
    end: isCalendarDate(exhibition.end) ? exhibition.end : null,
  };
}

/** 기록 id. randomUUID는 https·localhost에서만 있으므로 없으면 시각과 난수로 만든다 */
export function newRecordId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface NewRecordInput {
  entry: CatalogEntry;
  date: string;
  rating: number;
  // 소수면 반올림한다
  visitMinutes: number;
  note: string;
  shared: boolean;
  // 사용자 태그. normalizeTags로 정리해 넣는다(잘못된 태그는 버리고 기록은 만든다)
  tags?: readonly string[];
}

/**
 * 태그 필드. 정리한 태그가 있을 때만 { tags }를 돌려준다.
 * 태그가 없으면 필드를 두지 않아, 태그를 쓰지 않은 기록은 저장·내보내기 모양이 예전(#72까지)과 똑같다.
 */
function tagsField(raw: unknown): Pick<VisitRecord, 'tags'> {
  const tags = normalizeTags(raw);
  return tags.length ? { tags } : {};
}

/** 입력값으로 기록 한 건을 만든다. 형식이 틀리면 null */
export function createRecord(input: NewRecordInput, now: Date = new Date(), id: string = newRecordId()): VisitRecord | null {
  const record: VisitRecord = {
    id,
    exhibitionId: input.entry.exhibition.id,
    exhibition: snapshotOf(input.entry),
    date: input.date,
    rating: input.rating,
    visitMinutes: Math.round(input.visitMinutes),
    note: input.note.trim(),
    shared: input.shared,
    createdAt: now.toISOString(),
    ...tagsField(input.tags),
  };
  return isValidRecord(record) ? record : null;
}

// ─── 검증·옮기기 ────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function isValidRecord(r: VisitRecord): boolean {
  return (
    r.id !== '' &&
    r.exhibitionId !== '' &&
    r.exhibition.title !== '' &&
    isCalendarDate(r.date) &&
    isValidReview(r) &&
    Number.isInteger(r.visitMinutes)
  );
}

/** 저장된 전시 정보 사본을 읽는다. 제목이 없으면 null. 찜 목록(saved.ts)도 쓴다 */
export function readSnapshot(v: unknown): ExhibitionSnapshot | null {
  if (!isObject(v) || typeof v.title !== 'string' || v.title === '') return null;
  return {
    title: v.title,
    venueName: stringOrNull(v.venueName),
    venueId: stringOrNull(v.venueId),
    field: stringOrNull(v.field),
    imageUrl: stringOrNull(v.imageUrl),
    start: isCalendarDate(v.start) ? v.start : null,
    end: isCalendarDate(v.end) ? v.end : null,
  };
}

/** 시각 값을 ISO 8601(UTC)로 맞춘다. 읽을 수 없으면 null. 찜 목록(saved.ts)도 쓴다 */
export function toIso(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** createdAt이 없을 때: v1 id(Date.now 숫자)에서 만들고, 그것도 안 되면 관람일 0시(서울)로 둔다 */
function fallbackCreatedAt(id: string, date: string): string {
  if (/^\d{12,}$/.test(id)) {
    const fromId = toIso(Number(id));
    if (fromId) return fromId;
  }
  // date는 isCalendarDate를 거친 값이라 Invalid Date가 되지 않지만, 혹시 모르니 막아 둔다
  return toIso(`${date}T00:00:00+09:00`) ?? new Date(0).toISOString();
}

/**
 * 저장된 기록 한 건을 v2 형식으로 읽는다. v1(exhibitId, time, 사본 없음)도 받는다. 잘못되면 null.
 * - 카탈로그에 전시가 있으면 사본을 카탈로그에서 새로 만든다(최신 정보).
 * - 없으면 저장된 사본을 쓰고, 사본도 없으면(v1) 제목을 UNKNOWN_TITLE로 둔다.
 * - 관람 시간이 소수면 반올림한다(v1 화면은 소수를 막지 않았다).
 */
export function normalizeRecord(raw: unknown, lookup: CatalogLookup): VisitRecord | null {
  if (!isObject(raw)) return null;

  const idRaw = raw.id;
  const id = typeof idRaw === 'string' ? idRaw : typeof idRaw === 'number' ? String(idRaw) : '';
  const exRaw = raw.exhibitionId ?? raw.exhibitId;
  const exhibitionId = typeof exRaw === 'string' ? exRaw : typeof exRaw === 'number' ? String(exRaw) : '';
  const date = raw.date;
  const rating = raw.rating;
  const minutesRaw = raw.visitMinutes ?? raw.time;
  if (typeof rating !== 'number' || typeof minutesRaw !== 'number') return null;
  if (!id || !exhibitionId || !isCalendarDate(date)) return null;

  const found = lookup(exhibitionId);
  const exhibition = found
    ? snapshotOf(found)
    : (readSnapshot(raw.exhibition) ?? {
        title: UNKNOWN_TITLE,
        venueName: null,
        venueId: null,
        field: null,
        imageUrl: null,
        start: null,
        end: null,
      });

  const record: VisitRecord = {
    id,
    exhibitionId,
    exhibition,
    date,
    rating,
    visitMinutes: Math.round(minutesRaw),
    note: typeof raw.note === 'string' ? raw.note : '',
    shared: raw.shared === true,
    createdAt: toIso(raw.createdAt) ?? fallbackCreatedAt(id, date),
    // 태그는 다시 정리한다. 잘못된 태그만 버리고 기록은 살린다(태그는 선택 필드라 기록 전체를 버릴 이유가 없다)
    ...tagsField(raw.tags),
  };
  return isValidRecord(record) ? record : null;
}

/** 기록 배열을 읽는다. 잘못된 기록과 id가 겹치는 기록(뒤의 것)은 버린다 */
function normalizeRecords(raw: unknown, lookup: CatalogLookup): VisitRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: VisitRecord[] = [];
  for (const item of raw) {
    const r = normalizeRecord(item, lookup);
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** 관심 분야를 읽는다. 빈 값과 중복은 버린다 */
function normalizeInterests(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '')));
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// ─── 저장소 ────────────────────────────────────────────

/** 아무것도 저장하지 않는 저장소. localStorage를 쓸 수 없을 때 대신 쓴다 */
const NO_STORAGE: ArchiveStorage = {
  getItem: () => null,
  setItem: () => {
    throw new Error('저장소를 쓸 수 없음');
  },
  removeItem: () => {},
};

/** 브라우저 localStorage. 개인정보 보호 모드 등에서 접근만 해도 예외가 나면 NO_STORAGE */
export function browserStorage(): ArchiveStorage {
  try {
    return window.localStorage ?? NO_STORAGE;
  } catch {
    return NO_STORAGE;
  }
}

function safeGet(storage: ArchiveStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function removeLegacyKeys(storage: ArchiveStorage): void {
  try {
    storage.removeItem(LEGACY_RECORDS_KEY);
    storage.removeItem(LEGACY_INTERESTS_KEY);
  } catch {
    // 지우지 못해도 새 키를 먼저 읽으므로 동작에는 문제없다. 다음 저장 때 다시 지운다
  }
}

/**
 * 저장한다. 저장소가 꽉 찼거나 막혀 있으면 false.
 * 성공하면 남아 있는 v1 키도 지운다(처음 옮길 때 저장에 실패했던 경우).
 */
export function saveArchive(storage: ArchiveStorage, data: ArchiveData): boolean {
  try {
    storage.setItem(ARCHIVE_KEY, JSON.stringify(data));
  } catch {
    return false;
  }
  removeLegacyKeys(storage);
  return true;
}

export interface LoadResult {
  data: ArchiveData;
  // v1을 옮겨 저장하려다 실패했으면 true. 화면이 경고를 띄운다
  saveFailed: boolean;
}

/**
 * 저장소에서 읽기만 한다(저장하지 않음).
 * - 새 키에 version 2 데이터가 있으면 그것을 읽는다.
 * - 아니고 v1 키가 있으면 v2 형식으로 바꿔 돌려준다(fromLegacy: true).
 * - 둘 다 없거나 읽을 수 없으면 빈 아카이브.
 */
function readArchive(storage: ArchiveStorage, lookup: CatalogLookup): { data: ArchiveData; fromLegacy: boolean } {
  const current = parseJson(safeGet(storage, ARCHIVE_KEY));
  if (isObject(current) && current.version === ARCHIVE_VERSION) {
    return {
      data: {
        version: ARCHIVE_VERSION,
        records: normalizeRecords(current.records, lookup),
        interests: normalizeInterests(current.interests),
      },
      fromLegacy: false,
    };
  }

  const legacyRecords = safeGet(storage, LEGACY_RECORDS_KEY);
  const legacyInterests = safeGet(storage, LEGACY_INTERESTS_KEY);
  if (legacyRecords === null && legacyInterests === null) return { data: emptyArchive(), fromLegacy: false };

  return {
    data: {
      version: ARCHIVE_VERSION,
      records: normalizeRecords(parseJson(legacyRecords), lookup),
      interests: normalizeInterests(parseJson(legacyInterests)),
    },
    fromLegacy: true,
  };
}

/**
 * 아카이브를 읽는다(아카이브 화면용). v1 데이터였으면 v2로 옮겨 새 키에 저장한다(성공하면 v1 키를 지운다).
 */
export function loadArchive(storage: ArchiveStorage, lookup: CatalogLookup): LoadResult {
  const { data, fromLegacy } = readArchive(storage, lookup);
  if (!fromLegacy) return { data, saveFailed: false };
  return { data, saveFailed: !saveArchive(storage, data) };
}

/**
 * 관람 기록이 있는 전시 id 모음. 다른 화면의 "관람" 스탬프용.
 * 저장 형식은 이 파일만 알도록, 다른 화면은 localStorage를 직접 읽지 말고 이 함수를 쓴다.
 * 읽기만 하고 v1 데이터를 옮기지 않는다(옮기는 것은 아카이브 화면이 한다).
 */
export function readVisitedIds(storage: ArchiveStorage = browserStorage()): Set<string> {
  return new Set(readArchive(storage, () => undefined).data.records.map((r) => r.exhibitionId));
}

/** 아카이브 전체 삭제. 새 키와 v1 키를 모두 지운다. 실패하면 false */
export function clearArchive(storage: ArchiveStorage): boolean {
  try {
    storage.removeItem(ARCHIVE_KEY);
    storage.removeItem(LEGACY_RECORDS_KEY);
    storage.removeItem(LEGACY_INTERESTS_KEY);
    return true;
  } catch {
    return false;
  }
}

// ─── 내보내기 ────────────────────────────────────────────

/** 내보내기 파일 내용. 형식은 schema/personal-records-export.schema.json */
export function buildExport(data: ArchiveData, now: Date = new Date()): ArchiveExport {
  return {
    version: ARCHIVE_VERSION,
    exportedAt: now.toISOString(),
    records: data.records,
    interests: data.interests,
  };
}

/** 내보내기 파일 이름. 날짜는 서울 기준 (예: onjeonsi-archive-2026-11-21.json) */
export function exportFileName(now: Date = new Date()): string {
  return `onjeonsi-archive-${todayInSeoul(now)}.json`;
}

// ─── 가져오기 ────────────────────────────────────────────

/**
 * 가져올 수 있는 파일 크기 상한(바이트). localStorage는 보통 5MB 안팎이라 이보다 크면 어차피 저장하지 못한다.
 * 화면은 파일을 읽기 전에 file.size로 먼저 막는다.
 */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 가져오기 실패 이유
 * - too-large: 파일이 IMPORT_MAX_BYTES보다 크다. parseImport는 내지 않고, 화면이 file.size로 판단해 쓴다
 * - not-json: JSON이 아니다
 * - not-archive: 온전시 내보내기 파일 모양이 아니다(version·records가 없거나 형식이 다름)
 * - newer-version: 이 화면보다 새 버전 형식이다. 모르는 필드를 버리게 되므로 받지 않는다
 */
export type ImportError = 'too-large' | 'not-json' | 'not-archive' | 'newer-version';

export const IMPORT_ERROR_MESSAGE: Record<ImportError, string> = {
  'too-large': `파일이 너무 큽니다. ${IMPORT_MAX_BYTES / 1024 / 1024}MB 이하의 내보내기 파일만 가져올 수 있습니다.`,
  'not-json': 'JSON 파일이 아닙니다. 내보내기로 받은 파일을 고르십시오.',
  'not-archive': '온전시 아카이브 내보내기 파일이 아닙니다.',
  'newer-version': '더 새로운 버전에서 내보낸 파일입니다. 페이지를 새로고침한 뒤 다시 시도하십시오.',
};

/** 파일에서 읽은 아카이브. 기록은 normalizeRecord를 거쳤고 공유는 모두 꺼져 있다 */
export interface ImportedArchive {
  records: VisitRecord[];
  interests: string[];
  // 형식이 잘못됐거나, 관람일이 오늘보다 뒤이거나, 파일 안에서 id가 겹쳐 버린 기록 수
  invalid: number;
}

export type ImportParseResult = { ok: true; value: ImportedArchive } | { ok: false; error: ImportError };

/**
 * 내보내기 파일(buildExport 결과, schema/personal-records-export.schema.json) 내용을 읽는다. 저장하지 않는다.
 * - version이 ARCHIVE_VERSION이어야 한다. 더 크면 newer-version, 없거나 다르면 not-archive
 * - 기록은 저장소에서 읽을 때와 같은 규칙(normalizeRecord)으로 읽는다. 잘못된 기록과 파일 안에서 id가 겹친
 *   기록(뒤의 것)은 버리고 invalid로 센다. 카탈로그에 있는 전시는 사본을 최신으로 고친다
 * - 관람일이 오늘(서울)보다 뒤인 기록도 버린다. 화면 입력으로는 만들 수 없다(visitDate.ts).
 *   전시 기간 밖 기록은 받는다. 기간 검사(#75) 전에 남긴 기록이 내보낸 파일에 있을 수 있고,
 *   저장소에 있는 같은 기록도 지우지 않기 때문이다(공유 대상에서만 빠진다)
 * - 관심 주제는 화면에서 고르고 끌 수 있는 주제 태그(TAGS)만 받는다. 예전 분야 이름이나 모르는 값은
 *   화면에 보이지 않아 끌 수 없는데 추천에는 쓰이므로 버린다
 * - 익명 공유(shared)는 모두 끈다. 다른 기기에서 가져오면 새 익명 id로 올라가 같은 사람의 별점이 서버에
 *   두 번 집계될 수 있고, 파일을 가져오는 것만으로 서버에 올라가는 것도 사용자가 예상하기 어렵다.
 *   공유하려면 기록마다 다시 켠다
 * - exportedAt은 보지 않는다(사람이 고친 파일이어도 기록만 맞으면 받는다)
 */
export function parseImport(text: string, lookup: CatalogLookup, today: string = todayInSeoul()): ImportParseResult {
  // 메모장 등에서 저장하면 앞에 BOM이 붙을 수 있다
  const parsed = parseJson(text.replace(/^\uFEFF/, ''));
  if (parsed === undefined) return { ok: false, error: 'not-json' };
  if (!isObject(parsed) || typeof parsed.version !== 'number') return { ok: false, error: 'not-archive' };
  if (parsed.version > ARCHIVE_VERSION) return { ok: false, error: 'newer-version' };
  if (parsed.version !== ARCHIVE_VERSION || !Array.isArray(parsed.records)) return { ok: false, error: 'not-archive' };

  const records = normalizeRecords(parsed.records, lookup)
    .filter((r) => r.date <= today)
    .map((r) => ({ ...r, shared: false }));
  const tags = new Set<string>(TAGS);
  return {
    ok: true,
    value: {
      records,
      interests: normalizeInterests(parsed.interests).filter((i) => tags.has(i)),
      invalid: parsed.records.length - records.length,
    },
  };
}

export interface MergeResult {
  data: ArchiveData;
  // 새로 더한 기록 수
  added: number;
  // 이미 있어서(같은 id) 건너뛴 기록 수
  duplicates: number;
  // 새로 더한 관심 주제 수
  interestsAdded: number;
}

/**
 * 가져온 아카이브를 지금 아카이브에 합친다. 순수 함수다.
 * - 같은 id의 기록이 이미 있으면 지금 것을 남긴다. 같은 파일을 두 번 가져와도 기록이 늘지 않는다
 * - 새 기록은 지금 기록 뒤에 붙인다(화면은 관람일·만든 시각으로 다시 정렬한다)
 * - 관심 주제는 합친다. 지금 순서를 지키고 새 주제를 뒤에 붙인다
 */
export function mergeImport(current: ArchiveData, imported: ImportedArchive): MergeResult {
  const ids = new Set(current.records.map((r) => r.id));
  const added = imported.records.filter((r) => !ids.has(r.id));
  const interests = new Set(current.interests);
  const newInterests = imported.interests.filter((i) => !interests.has(i));
  return {
    data: {
      version: ARCHIVE_VERSION,
      records: [...current.records, ...added],
      interests: [...current.interests, ...newInterests],
    },
    added: added.length,
    duplicates: imported.records.length - added.length,
    interestsAdded: newInterests.length,
  };
}

// ─── 화면 표시 ────────────────────────────────────────────

/**
 * 전시 상태
 * - listed: 카탈로그에 있다 (상세 보기 가능)
 * - ended: 카탈로그에 없고 사본의 종료일이 지났다
 * - unlisted: 카탈로그에 없고 끝났는지 모른다 (종료일을 모르거나 아직 안 지남)
 */
export type RecordStatus = 'listed' | 'ended' | 'unlisted';

export interface RecordView {
  title: string;
  venueName: string | null;
  field: string | null;
  imageUrl: string | null;
  status: RecordStatus;
}

/** 카드에 보일 전시 정보. 카탈로그에 있으면 최신 정보를, 없으면 기록할 때의 사본을 쓴다 */
export function viewOf(record: VisitRecord, found: CatalogEntry | undefined, today: string): RecordView {
  const s = found ? snapshotOf(found) : record.exhibition;
  const status: RecordStatus = found ? 'listed' : s.end !== null && s.end < today ? 'ended' : 'unlisted';
  return { title: s.title, venueName: s.venueName, field: s.field, imageUrl: s.imageUrl, status };
}
