/**
 * 찜(가볼 전시) 목록 읽기·저장·구독.
 *
 * - 저장 키는 SAVED_KEY 하나이고 아카이브(onjeonsi:archive)와 따로 둔다.
 *   아카이브 화면은 아카이브 전체를 state로 들고 통째로 저장한다. 상세 창은 아카이브 화면 위에서도 열리므로,
 *   같은 키에 두면 상세 창에서 찜한 것을 아카이브 화면의 오래된 state가 덮어쓴다.
 * - 다른 화면은 localStorage를 직접 읽지 말고 savedStore()를 쓴다. React에서는
 *   useSyncExternalStore(savedStore().subscribe, savedStore().getIds)로 읽으면 찜이 바뀔 때 다시 그린다.
 * - 전시 정보 사본을 같이 저장한다. 끝난 전시는 수집할 때 auto.json에서 빠지므로,
 *   카탈로그에서 못 찾아도 "종료된 전시"로 보여 주려고 둔다. 화면용으로 나누는 것은 splitSaved가 한다.
 * - 읽을 때 카탈로그에 전시가 있으면 사본을 최신으로 고친다(아카이브와 같다). 저장소에는 다음에 저장할 때 들어간다.
 * - 잘못된 항목(전시 id나 찜한 시각이 없는 것, 카탈로그에 없는데 사본도 없는 것)과
 *   같은 전시를 두 번 찜한 항목(뒤의 것)은 읽을 때 버린다.
 */
import type { JudgeResult } from '../types';
import { SAVED_VERSION, type ExhibitionSnapshot, type SavedData, type SavedItem } from '../types/records';
import { browserStorage, readSnapshot, snapshotOf, toIso, type ArchiveStorage, type CatalogLookup } from './archive';
import { getCatalog, type CatalogEntry, type CatalogQuery } from './catalog';

export const SAVED_KEY = 'onjeonsi:saved';
/** 읽을 수 없는 찜 데이터(깨진 JSON, 다른 버전)를 새 목록으로 덮어쓰기 전에 원본을 옮겨 두는 키. 화면은 읽지 않는다(손으로 되살리는 용도) */
export const SAVED_BACKUP_KEY = 'onjeonsi:saved:backup';

/** 다른 탭이 저장소를 바꿨다는 알림(storage 이벤트)을 받을 대상. 브라우저에서는 window */
export interface StorageEvents {
  addEventListener(type: 'storage', listener: (e: { key: string | null }) => void): void;
  removeEventListener(type: 'storage', listener: (e: { key: string | null }) => void): void;
}

/** toggle 결과. failed면 저장하지 못했고 찜 목록은 그대로다 (개인정보 보호 모드, 저장 공간 부족 등) */
export type ToggleResult = 'added' | 'removed' | 'failed';

export interface SavedStore {
  /** 찜이 바뀌면(이 탭에서 저장했거나 다른 탭에서 바꿨을 때) listener를 부른다. 해제 함수를 돌려준다 */
  subscribe: (listener: () => void) => () => void;
  /** 찜 목록 (먼저 찜한 것이 앞). 저장소가 바뀌지 않았으면 같은 배열을 돌려준다 */
  getItems: () => readonly SavedItem[];
  /** 찜한 전시 id 모음. 저장소가 바뀌지 않았으면 같은 Set을 돌려준다 */
  getIds: () => ReadonlySet<string>;
  /** 찜하지 않은 전시면 찜하고, 찜한 전시면 뺀다 */
  toggle: (entry: CatalogEntry, now?: Date) => ToggleResult;
  /** 전시들을 찜에서 뺀다(끝난 전시 정리 등). 찜에 없는 id는 무시한다. 저장하지 못하면 false */
  remove: (exhibitionIds: readonly string[]) => boolean;
  /** 찜을 모두 지운다. 지우지 못하면 false */
  clear: () => boolean;
}

// ─── 읽기 ────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 저장된 찜 한 건을 읽는다. 잘못되면 null.
 * 카탈로그에 전시가 있으면 사본을 카탈로그에서 새로 만들고, 없으면 저장된 사본을 쓴다.
 */
export function normalizeSavedItem(raw: unknown, lookup: CatalogLookup): SavedItem | null {
  if (!isObject(raw)) return null;
  const exhibitionId = raw.exhibitionId;
  if (typeof exhibitionId !== 'string' || exhibitionId === '') return null;
  const savedAt = toIso(raw.savedAt);
  if (savedAt === null) return null;

  const found = lookup(exhibitionId);
  const exhibition = found ? snapshotOf(found) : readSnapshot(raw.exhibition);
  return exhibition ? { exhibitionId, savedAt, exhibition } : null;
}

/**
 * 저장소 문자열을 찜 목록으로 읽는다.
 * readable이 false면 값은 있는데 읽을 수 없다(JSON이 깨졌거나, 형식이 다르거나, 다른 버전). 이때 items는 빈 목록이다.
 */
function readSaved(raw: string | null, lookup: CatalogLookup): { items: SavedItem[]; readable: boolean } {
  if (raw === null) return { items: [], readable: true };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { items: [], readable: false };
  }
  if (!isObject(data) || data.version !== SAVED_VERSION || !Array.isArray(data.items)) return { items: [], readable: false };

  const seen = new Set<string>();
  const items: SavedItem[] = [];
  for (const item of data.items) {
    const saved = normalizeSavedItem(item, lookup);
    if (!saved || seen.has(saved.exhibitionId)) continue;
    seen.add(saved.exhibitionId);
    items.push(saved);
  }
  return { items, readable: true };
}

/** 저장소 문자열을 찜 목록으로 읽는다. 없거나 깨졌거나 버전이 다르면 빈 목록 */
export function parseSaved(raw: string | null, lookup: CatalogLookup): SavedItem[] {
  return readSaved(raw, lookup).items;
}

// ─── 저장소 ────────────────────────────────────────────

/**
 * 찜 저장소를 만든다. 화면은 savedStore()를, 테스트는 메모리 저장소로 이 함수를 쓴다.
 * events를 주면 구독자가 있는 동안 다른 탭의 변경을 받아 구독자에게 알린다.
 */
export function createSavedStore(storage: ArchiveStorage, lookup: CatalogLookup, events: StorageEvents | null = null): SavedStore {
  const listeners = new Set<() => void>();
  // 마지막으로 읽은 저장소 문자열과 그 결과.
  // 문자열이 같으면 같은 배열·Set을 돌려준다(useSyncExternalStore는 같은 값이면 같은 참조여야 한다).
  // 매번 저장소를 읽어 비교하므로, 구독하지 않는 동안 다른 탭이 바꾼 것도 놓치지 않는다.
  // state: ok(읽음) / unreadable(값은 있는데 읽을 수 없음) / inaccessible(저장소를 읽다가 예외)
  // 캐시는 저장소에서 읽은 것(raw, accessible)으로만 비교한다. 읽은 뒤 정해지는 state로 비교하면 매번 새로 읽어 무한 렌더가 된다
  type State = 'ok' | 'unreadable' | 'inaccessible';
  let cache: { raw: string | null; accessible: boolean; state: State; items: readonly SavedItem[]; ids: ReadonlySet<string> } | null = null;

  function current() {
    let raw: string | null = null;
    let accessible = true;
    try {
      raw = storage.getItem(SAVED_KEY);
    } catch {
      accessible = false;
    }
    if (cache === null || cache.raw !== raw || cache.accessible !== accessible) {
      const read = readSaved(raw, lookup);
      const state: State = !accessible ? 'inaccessible' : read.readable ? 'ok' : 'unreadable';
      cache = { raw, accessible, state, items: read.items, ids: new Set(read.items.map((item) => item.exhibitionId)) };
    }
    return cache;
  }

  function notify() {
    listeners.forEach((fn) => fn());
  }

  /**
   * 저장 직전에 저장소를 다시 읽고(current) 고친다. 다른 탭이 저장한 직후 storage 이벤트가 오기 전에 눌러도 덮어쓰지 않는다.
   * 읽지 못한 값은 빈 목록으로 보이므로, 그대로 쓰면 있던 찜이 새 목록으로 덮어써진다. 그래서
   * - 저장소를 읽지 못했으면(inaccessible) 쓰지 않는다.
   * - 값을 읽을 수 없으면(unreadable) 원본을 SAVED_BACKUP_KEY에 옮겨 두고 쓴다. 옮기지 못하면 쓰지 않는다.
   */
  function write(items: SavedItem[]): boolean {
    const { raw, state } = current();
    if (state === 'inaccessible') return false;
    const data: SavedData = { version: SAVED_VERSION, items };
    try {
      if (state === 'unreadable' && raw !== null) storage.setItem(SAVED_BACKUP_KEY, raw);
      storage.setItem(SAVED_KEY, JSON.stringify(data));
    } catch {
      return false;
    }
    notify();
    return true;
  }

  // 다른 탭에서 찜을 바꿨거나 localStorage.clear()를 불렀으면(key가 null) 알린다. 새 값은 getItems가 저장소에서 읽는다
  function onStorage(e: { key: string | null }) {
    if (e.key === SAVED_KEY || e.key === null) notify();
  }

  return {
    subscribe: (listener) => {
      if (listeners.size === 0) events?.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0) events?.removeEventListener('storage', onStorage);
      };
    },

    getItems: () => current().items,
    getIds: () => current().ids,

    toggle: (entry, now = new Date()) => {
      const id = entry.exhibition.id;
      const { items, ids } = current();
      if (ids.has(id)) {
        return write(items.filter((item) => item.exhibitionId !== id)) ? 'removed' : 'failed';
      }
      const added: SavedItem = { exhibitionId: id, savedAt: now.toISOString(), exhibition: snapshotOf(entry) };
      return write([...items, added]) ? 'added' : 'failed';
    },

    remove: (exhibitionIds) => {
      const drop = new Set(exhibitionIds);
      const { items } = current();
      // 뺄 것이 없으면 저장하지 않는다
      if (!items.some((item) => drop.has(item.exhibitionId))) return true;
      return write(items.filter((item) => !drop.has(item.exhibitionId)));
    },

    clear: () => {
      try {
        storage.removeItem(SAVED_KEY);
      } catch {
        return false;
      }
      notify();
      return true;
    },
  };
}

// ─── 화면 표시 ────────────────────────────────────────────

/**
 * 찜 항목의 상태
 * - active: 카탈로그에 있고 아직 끝나지 않았다 (상세 보기·판정 가능)
 * - ended: 종료일이 오늘 전이다 (카탈로그에 남아 있어도)
 * - unlisted: 카탈로그에 없고 끝났는지 모른다 (종료일을 모르거나 아직 안 지남)
 */
export type SavedStatus = 'active' | 'ended' | 'unlisted';

export interface SavedRow {
  item: SavedItem;
  // 카탈로그 항목. 카탈로그에서 빠졌으면 undefined
  entry: CatalogEntry | undefined;
  // 화면에 보일 전시 정보. 카탈로그에 있으면 최신 정보, 없으면 찜할 때의 사본
  exhibition: ExhibitionSnapshot;
  status: SavedStatus;
}

/** 진행 중인 전시. 카탈로그 항목이 항상 있다 */
export interface ActiveRow extends SavedRow {
  entry: CatalogEntry;
  status: 'active';
}

/** 'YYYY-MM-DD' 두 날짜 사이의 일수 (to - from) */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 남은 일수가 이 값 이하면 화면에서 '곧 종료'로 강조한다 */
export const SOON_DAYS = 7;

/** 종료일까지 남은 일수. 오늘 끝나면 0, 이미 끝났으면 음수, 종료일을 모르면 null */
export function daysLeft(end: string | null, today: string): number | null {
  return end === null ? null : daysBetween(today, end);
}

/** 카드에 붙일 기간 문구. 개막 전이면 개막일, 진행 중이면 D-day, 날짜를 모르면 빈 문자열 */
export function periodLabel(start: string | null, end: string | null, today: string): string {
  if (start !== null && start > today) {
    const [, m, d] = start.split('-').map(Number);
    return `${m}/${d} 개막`;
  }
  const left = daysLeft(end, today);
  if (left === null || left < 0) return '';
  return left === 0 ? '오늘 종료' : `D-${left}`;
}

// 내 주변 화면의 기본 시간대와 같게 판정한다 (src/pages/NearbyExhibitions.tsx의 NOW)
const GLANCE_MINUTES = 120;
const LAST_SLOT = 23 * 60 + 50;

function hhmm(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 북마크 화면의 판정 조건. 내 주변 화면의 기본값과 같다:
 * 지금 시각을 10분 단위로 내린 때부터 2시간, 23:50을 넘지 않는다.
 * 그래서 같은 전시가 내 주변과 북마크에서 같은 가능/불가로 나온다. 상세 창을 열 때도 이 조건을 넘긴다.
 * 다른 점 하나: 23:50 이후에는 내 주변은 시작·끝이 모두 23:50이 되어 시간 범위 오류로 판정하지 않지만,
 * 여기서는 끝을 23:59로 두고 판정한다(북마크 화면에는 시간을 고칠 입력이 없어서).
 */
export function glanceQuery(date: string, time: string): CatalogQuery {
  const [h, m] = time.split(':').map(Number);
  const start = Math.min(h * 60 + Math.floor(m / 10) * 10, LAST_SLOT);
  const end = Math.min(start + GLANCE_MINUTES, LAST_SLOT);
  return { date, stayStart: hhmm(start), stayEnd: end > start ? hhmm(end) : '23:59' };
}

/**
 * 판정이 '가능'이지만 시작 시각(from)보다 늦게 입장할 수 있으면 그 입장 시각('14:00'), 아니면 null.
 * 내 주변 화면처럼 '14:00 입장'을 덧붙여 보여 주려고 쓴다.
 */
export function laterEntry(judge: Pick<JudgeResult, 'result' | 'entryTime'>, from: string): string | null {
  return judge.result === 'possible' && judge.entryTime !== undefined && judge.entryTime > from ? judge.entryTime : null;
}

/**
 * 찜 목록을 화면용으로 나눈다.
 * - active: 곧 끝나는 순 (종료일이 같거나 모르면 먼저 찜한 순)
 * - gone: 끝났거나(ended) 카탈로그에서 빠진(unlisted) 전시. 먼저 찜한 순. "정리" 대상
 */
export function splitSaved(items: readonly SavedItem[], lookup: CatalogLookup, today: string): { active: ActiveRow[]; gone: SavedRow[] } {
  const active: ActiveRow[] = [];
  const gone: SavedRow[] = [];
  for (const item of items) {
    const entry = lookup(item.exhibitionId);
    const exhibition = entry ? snapshotOf(entry) : item.exhibition;
    const { end } = exhibition;
    if (end !== null && end < today) gone.push({ item, entry, exhibition, status: 'ended' });
    else if (entry) active.push({ item, entry, exhibition, status: 'active' });
    else gone.push({ item, entry, exhibition, status: 'unlisted' });
  }
  // 종료일을 모르면 맨 뒤로. sort는 안정 정렬이라 같으면 찜한 순서가 남는다
  const endKey = (row: SavedRow) => row.exhibition.end ?? '9999-12-31';
  active.sort((a, b) => endKey(a).localeCompare(endKey(b)));
  return { active, gone };
}

let defaultStore: SavedStore | null = null;

/** 화면이 쓰는 찜 저장소. 브라우저 localStorage와 번들된 카탈로그를 쓴다. 처음 부를 때 만든다 */
export function savedStore(): SavedStore {
  if (defaultStore === null) {
    let byId: Map<string, CatalogEntry> | null = null;
    const lookup: CatalogLookup = (id) => {
      byId ??= new Map(getCatalog().map((entry) => [entry.exhibition.id, entry]));
      return byId.get(id);
    };
    defaultStore = createSavedStore(browserStorage(), lookup, typeof window === 'undefined' ? null : window);
  }
  return defaultStore;
}
