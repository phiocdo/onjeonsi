import { describe, expect, it, vi } from 'vitest';
import type { Exhibition, Venue } from '../types';
import { SAVED_VERSION } from '../types/records';
import { snapshotOf, type ArchiveStorage, type CatalogLookup } from './archive';
import type { CatalogEntry } from './catalog';
import {
  SAVED_BACKUP_KEY,
  SAVED_KEY,
  createSavedStore,
  daysLeft,
  glanceQuery,
  glanceRangeText,
  laterEntry,
  normalizeSavedItem,
  parseSaved,
  periodLabel,
  splitSaved,
  type StorageEvents,
} from './saved';

// ─── fixture ─────────────────────────────────────────────

/** 메모리 저장소. fail을 켜면 setItem·removeItem이, failRead를 켜면 getItem이 예외를 던진다 */
class MemoryStorage implements ArchiveStorage {
  data = new Map<string, string>();
  fail = false;
  failRead = false;
  writes = 0;
  getItem(key: string) {
    if (this.failRead) throw new Error('SecurityError');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('QuotaExceededError');
    this.writes += 1;
    this.data.set(key, value);
  }
  removeItem(key: string) {
    if (this.fail) throw new Error('SecurityError');
    this.data.delete(key);
  }
}

/** window 대신 쓰는 storage 이벤트 대상. fire로 다른 탭의 변경을 흉내 낸다 */
class FakeEvents implements StorageEvents {
  listeners = new Set<(e: { key: string | null }) => void>();
  addEventListener(_type: 'storage', listener: (e: { key: string | null }) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'storage', listener: (e: { key: string | null }) => void) {
    this.listeners.delete(listener);
  }
  fire(key: string | null) {
    this.listeners.forEach((fn) => fn({ key }));
  }
}

const VENUE = { id: 'venue-sema', name: '서울시립미술관' } as Venue;

function entryOf(id: string, title: string, end = '2026-12-31'): CatalogEntry {
  const exhibition: Exhibition = {
    id,
    venueId: 'venue-sema',
    title,
    start: '2026-11-01',
    end,
    field: '전시/미술',
    placeName: '서울시립미술관 서소문본관',
    imageUrl: 'https://example.com/a.jpg',
  };
  return { exhibition, venue: VENUE, match: { venueId: 'venue-sema', by: 'link' }, resolved: {} } as unknown as CatalogEntry;
}

const A = entryOf('auto-seoul-100', '빛의 정원');
const B = entryOf('auto-seoul-200', '서울의 밤');
const CATALOG = new Map([A, B].map((e) => [e.exhibition.id, e]));
const lookup: CatalogLookup = (id) => CATALOG.get(id);
const nothing: CatalogLookup = () => undefined;
const NOW = new Date('2026-11-24T03:00:00.000Z');
const TODAY = '2026-11-24';

/** 카탈로그에서 빠진 전시의 저장된 사본 */
const GONE_SNAPSHOT = {
  title: '끝난 전시',
  venueName: '어느 미술관',
  venueId: null,
  field: '전시/미술',
  imageUrl: null,
  start: '2026-10-01',
  end: '2026-11-10',
};

function stored(items: unknown[], version: unknown = SAVED_VERSION): string {
  return JSON.stringify({ version, items });
}

function setup(lookupFn: CatalogLookup = lookup) {
  const storage = new MemoryStorage();
  const events = new FakeEvents();
  const store = createSavedStore(storage, lookupFn, events);
  return { storage, events, store };
}

// ─── 읽기 ─────────────────────────────────────────────

describe('normalizeSavedItem', () => {
  it('카탈로그에 있으면 사본을 카탈로그에서 새로 만든다', () => {
    const raw = { exhibitionId: A.exhibition.id, savedAt: NOW.toISOString(), exhibition: { ...GONE_SNAPSHOT, title: '예전 제목' } };
    expect(normalizeSavedItem(raw, lookup)).toEqual({ exhibitionId: A.exhibition.id, savedAt: NOW.toISOString(), exhibition: snapshotOf(A) });
  });

  it('카탈로그에 없으면 저장된 사본을 쓴다', () => {
    const raw = { exhibitionId: 'auto-seoul-999', savedAt: NOW.toISOString(), exhibition: GONE_SNAPSHOT };
    expect(normalizeSavedItem(raw, nothing)?.exhibition).toEqual(GONE_SNAPSHOT);
  });

  it('카탈로그에 없고 사본에 제목도 없으면 버린다', () => {
    expect(normalizeSavedItem({ exhibitionId: 'auto-seoul-999', savedAt: NOW.toISOString() }, nothing)).toBeNull();
    expect(normalizeSavedItem({ exhibitionId: 'auto-seoul-999', savedAt: NOW.toISOString(), exhibition: { title: '' } }, nothing)).toBeNull();
  });

  it('전시 id나 찜한 시각이 잘못되면 버린다', () => {
    const at = NOW.toISOString();
    expect(normalizeSavedItem(null, lookup)).toBeNull();
    expect(normalizeSavedItem([], lookup)).toBeNull();
    expect(normalizeSavedItem({ exhibitionId: '', savedAt: at }, lookup)).toBeNull();
    expect(normalizeSavedItem({ exhibitionId: 100, savedAt: at }, lookup)).toBeNull();
    expect(normalizeSavedItem({ exhibitionId: A.exhibition.id }, lookup)).toBeNull();
    expect(normalizeSavedItem({ exhibitionId: A.exhibition.id, savedAt: '어제' }, lookup)).toBeNull();
  });

  it('찜한 시각은 ISO 8601(UTC)로 맞춘다', () => {
    expect(normalizeSavedItem({ exhibitionId: A.exhibition.id, savedAt: NOW.getTime() }, lookup)?.savedAt).toBe(NOW.toISOString());
    expect(normalizeSavedItem({ exhibitionId: A.exhibition.id, savedAt: '2026-11-24T12:00:00+09:00' }, lookup)?.savedAt).toBe(NOW.toISOString());
  });
});

describe('parseSaved', () => {
  it('없거나 깨졌거나 형식·버전이 다르면 빈 목록', () => {
    expect(parseSaved(null, lookup)).toEqual([]);
    expect(parseSaved('{', lookup)).toEqual([]);
    expect(parseSaved('null', lookup)).toEqual([]);
    expect(parseSaved('[]', lookup)).toEqual([]);
    expect(parseSaved(JSON.stringify({ version: SAVED_VERSION, items: {} }), lookup)).toEqual([]);
    expect(parseSaved(stored([{ exhibitionId: A.exhibition.id, savedAt: NOW.toISOString() }], 2), lookup)).toEqual([]);
  });

  it('잘못된 항목만 버리고, 같은 전시를 두 번 찜했으면 앞의 것을 남긴다', () => {
    const first = '2026-11-20T00:00:00.000Z';
    const items = parseSaved(
      stored([
        { exhibitionId: A.exhibition.id, savedAt: first },
        { exhibitionId: '', savedAt: first },
        { exhibitionId: B.exhibition.id, savedAt: NOW.toISOString() },
        { exhibitionId: A.exhibition.id, savedAt: NOW.toISOString() },
      ]),
      lookup,
    );
    expect(items.map((i) => [i.exhibitionId, i.savedAt])).toEqual([
      [A.exhibition.id, first],
      [B.exhibition.id, NOW.toISOString()],
    ]);
  });
});

// ─── 저장소 ─────────────────────────────────────────────

describe('createSavedStore', () => {
  it('저장소가 비어 있으면 빈 목록', () => {
    const { store } = setup();
    expect(store.getItems()).toEqual([]);
    expect(store.getIds().size).toBe(0);
  });

  it('toggle: 찜하면 사본과 함께 v1 형식으로 저장하고, 다시 누르면 뺀다', () => {
    const { storage, store } = setup();

    expect(store.toggle(A, NOW)).toBe('added');
    expect(JSON.parse(storage.data.get(SAVED_KEY)!)).toEqual({
      version: 1,
      items: [{ exhibitionId: A.exhibition.id, savedAt: NOW.toISOString(), exhibition: snapshotOf(A) }],
    });
    expect(store.getIds().has(A.exhibition.id)).toBe(true);

    expect(store.toggle(A, NOW)).toBe('removed');
    expect(store.getItems()).toEqual([]);
    expect(store.getIds().has(A.exhibition.id)).toBe(false);
  });

  it('찜한 순서를 지킨다', () => {
    const { store } = setup();
    store.toggle(B, NOW);
    store.toggle(A, NOW);
    expect(store.getItems().map((i) => i.exhibitionId)).toEqual([B.exhibition.id, A.exhibition.id]);
  });

  it('저장소가 그대로면 같은 배열·Set을 돌려주고, 바뀌면 새로 돌려준다', () => {
    const { store } = setup();
    const items = store.getItems();
    const ids = store.getIds();
    expect(store.getItems()).toBe(items);
    expect(store.getIds()).toBe(ids);

    store.toggle(A, NOW);
    expect(store.getItems()).not.toBe(items);
    expect(store.getIds()).not.toBe(ids);
    expect(store.getIds()).toBe(store.getIds());
  });

  it.each([
    ['깨진 JSON', (s: MemoryStorage) => s.data.set(SAVED_KEY, '{')],
    ['다른 버전', (s: MemoryStorage) => s.data.set(SAVED_KEY, stored([], 2))],
    ['저장소 읽기 예외', (s: MemoryStorage) => { s.failRead = true; }],
  ])('읽을 수 없을 때(%s)도 같은 배열·Set을 돌려준다 (다르면 React가 무한 렌더)', (_name, breakIt) => {
    const { storage, store } = setup();
    breakIt(storage);
    expect(store.getItems()).toBe(store.getItems());
    expect(store.getIds()).toBe(store.getIds());
  });

  it('저장하지 못하면 failed이고 목록도 알림도 그대로다', () => {
    const { storage, store } = setup();
    store.toggle(A, NOW);
    const listener = vi.fn();
    store.subscribe(listener);
    storage.fail = true;

    expect(store.toggle(B, NOW)).toBe('failed');
    expect(store.toggle(A, NOW)).toBe('failed');
    expect(store.getItems().map((i) => i.exhibitionId)).toEqual([A.exhibition.id]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('저장소를 읽을 수 없으면 빈 목록 (개인정보 보호 모드 등)', () => {
    const { storage, store } = setup();
    storage.failRead = true;
    expect(store.getItems()).toEqual([]);
  });

  it('저장소를 읽다가 예외가 나면 쓰지 않는다 (있던 찜을 빈 목록으로 덮어쓰지 않게)', () => {
    const { storage, store } = setup();
    storage.data.set(SAVED_KEY, stored([{ exhibitionId: A.exhibition.id, savedAt: NOW.toISOString() }]));
    storage.failRead = true;

    expect(store.toggle(B, NOW)).toBe('failed');
    expect(store.remove([A.exhibition.id])).toBe(true); // 보이는 목록이 비어 뺄 것이 없다
    storage.failRead = false;
    expect(store.getItems().map((i) => i.exhibitionId)).toEqual([A.exhibition.id]);
  });

  it.each([
    ['깨진 JSON', '{"version":1,"items":['],
    ['다른 버전', stored([{ exhibitionId: A.exhibition.id, savedAt: NOW.toISOString() }], 2)],
    ['형식이 다름', JSON.stringify({ version: 1, items: 'A' })],
  ])('읽을 수 없는 값(%s)은 덮어쓰기 전에 원본을 백업 키에 옮긴다', (_name, raw) => {
    const { storage, store } = setup();
    storage.data.set(SAVED_KEY, raw);

    expect(store.getItems()).toEqual([]);
    expect(store.toggle(B, NOW)).toBe('added');
    expect(storage.data.get(SAVED_BACKUP_KEY)).toBe(raw);
    expect(store.getItems().map((i) => i.exhibitionId)).toEqual([B.exhibition.id]);

    // 한 번 새로 쓴 뒤에는 읽을 수 있으므로 백업을 다시 건드리지 않는다
    store.toggle(A, NOW);
    expect(storage.data.get(SAVED_BACKUP_KEY)).toBe(raw);
  });

  it('백업을 쓰지 못하면 원본도 그대로 두고 failed', () => {
    const { storage, store } = setup();
    storage.data.set(SAVED_KEY, '{');
    storage.fail = true;
    expect(store.toggle(B, NOW)).toBe('failed');
    expect(storage.data.get(SAVED_KEY)).toBe('{');
    expect(storage.data.has(SAVED_BACKUP_KEY)).toBe(false);
  });

  it('읽을 수 있는 값이면 백업 키를 쓰지 않는다', () => {
    const { storage, store } = setup();
    store.toggle(A, NOW);
    store.toggle(B, NOW);
    expect(storage.data.has(SAVED_BACKUP_KEY)).toBe(false);
  });

  it('subscribe: 저장하면 알리고, 해제하면 더 알리지 않는다', () => {
    const { store } = setup();
    const listener = vi.fn();
    const off = store.subscribe(listener);

    store.toggle(A, NOW);
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    store.toggle(A, NOW);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('카탈로그에서 고친 사본은 다음에 저장할 때 저장소에 들어간다', () => {
    const { storage, store } = setup();
    storage.data.set(SAVED_KEY, stored([{ exhibitionId: A.exhibition.id, savedAt: NOW.toISOString(), exhibition: { ...GONE_SNAPSHOT, title: '예전 제목' } }]));

    expect(store.getItems()[0].exhibition.title).toBe('빛의 정원');
    store.toggle(B, NOW);
    expect(JSON.parse(storage.data.get(SAVED_KEY)!).items[0].exhibition).toEqual(snapshotOf(A));
  });
});

describe('createSavedStore — 다른 탭', () => {
  it('다른 탭이 저장소를 바꾸면 이벤트가 오기 전에도 새 값을 읽는다', () => {
    const { storage, store } = setup();
    expect(store.getIds().size).toBe(0);
    storage.data.set(SAVED_KEY, stored([{ exhibitionId: A.exhibition.id, savedAt: NOW.toISOString() }]));
    expect(store.getIds().has(A.exhibition.id)).toBe(true);
  });

  it('다른 탭이 찜한 것을 이 탭의 toggle이 덮어쓰지 않는다', () => {
    const { storage, store } = setup();
    store.toggle(A, NOW);
    // 다른 탭이 B를 찜했다 (이 탭에는 아직 이벤트가 오지 않음)
    const otherTab = createSavedStore(storage, lookup);
    otherTab.toggle(B, NOW);

    store.toggle(A, NOW);
    expect(store.getItems().map((i) => i.exhibitionId)).toEqual([B.exhibition.id]);
  });

  it('storage 이벤트: 찜 키나 전체 삭제(key null)면 알리고, 다른 키는 무시한다', () => {
    const { events, store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);

    events.fire('onjeonsi:archive');
    expect(listener).not.toHaveBeenCalled();
    events.fire(SAVED_KEY);
    expect(listener).toHaveBeenCalledTimes(1);
    events.fire(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('구독자가 있을 때만 storage 이벤트를 받는다', () => {
    const { events, store } = setup();
    expect(events.listeners.size).toBe(0);

    const off1 = store.subscribe(() => {});
    const off2 = store.subscribe(() => {});
    expect(events.listeners.size).toBe(1);

    off1();
    off1();
    expect(events.listeners.size).toBe(1);
    off2();
    expect(events.listeners.size).toBe(0);
  });
});

describe('createSavedStore — remove·clear', () => {
  it('remove: 여러 전시를 한 번에 빼고, 찜에 없는 id는 무시한다', () => {
    const { store } = setup();
    store.toggle(A, NOW);
    store.toggle(B, NOW);
    expect(store.remove([A.exhibition.id, B.exhibition.id, 'auto-seoul-999'])).toBe(true);
    expect(store.getItems()).toEqual([]);
  });

  it('remove: 뺄 것이 없으면 저장하지 않는다', () => {
    const { storage, store } = setup();
    store.toggle(A, NOW);
    const writes = storage.writes;
    expect(store.remove(['auto-seoul-999'])).toBe(true);
    expect(storage.writes).toBe(writes);
  });

  it('remove: 저장하지 못하면 false', () => {
    const { storage, store } = setup();
    store.toggle(A, NOW);
    storage.fail = true;
    expect(store.remove([A.exhibition.id])).toBe(false);
    expect(store.getIds().has(A.exhibition.id)).toBe(true);
  });

  it('clear: 모두 지우고 알린다. 지우지 못하면 false', () => {
    const { storage, store } = setup();
    store.toggle(A, NOW);
    const listener = vi.fn();
    store.subscribe(listener);

    storage.fail = true;
    expect(store.clear()).toBe(false);
    expect(store.getItems()).toHaveLength(1);

    storage.fail = false;
    expect(store.clear()).toBe(true);
    expect(storage.data.has(SAVED_KEY)).toBe(false);
    expect(store.getItems()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ─── 화면 표시 ─────────────────────────────────────────────

describe('daysLeft·periodLabel', () => {
  it('종료일까지 남은 일수. 오늘 끝나면 0, 지났으면 음수, 모르면 null', () => {
    expect(daysLeft('2026-11-27', TODAY)).toBe(3);
    expect(daysLeft(TODAY, TODAY)).toBe(0);
    expect(daysLeft('2026-11-23', TODAY)).toBe(-1);
    expect(daysLeft('2027-01-01', '2026-12-31')).toBe(1);
    expect(daysLeft(null, TODAY)).toBeNull();
  });

  it('개막 전이면 개막일, 진행 중이면 D-day, 오늘 끝나면 오늘 종료', () => {
    expect(periodLabel('2026-12-05', '2027-01-31', TODAY)).toBe('12/5 개막');
    expect(periodLabel('2026-11-01', '2026-11-27', TODAY)).toBe('D-3');
    expect(periodLabel('2026-11-01', TODAY, TODAY)).toBe('오늘 종료');
  });

  it('끝났거나 날짜를 모르면 빈 문자열', () => {
    expect(periodLabel('2026-11-01', '2026-11-23', TODAY)).toBe('');
    expect(periodLabel(null, null, TODAY)).toBe('');
  });
});

describe('glanceQuery', () => {
  it('내 주변 기본값과 같이 10분 단위로 내린 지금부터 2시간', () => {
    expect(glanceQuery(TODAY, '13:17')).toEqual({ date: TODAY, stayStart: '13:10', stayEnd: '15:10' });
    expect(glanceQuery(TODAY, '00:05')).toEqual({ date: TODAY, stayStart: '00:00', stayEnd: '02:00' });
  });

  it('끝은 23:50을 넘지 않고, 23:50 이후는 23:40~23:50', () => {
    expect(glanceQuery(TODAY, '22:45')).toEqual({ date: TODAY, stayStart: '22:40', stayEnd: '23:50' });
    // 예전에는 23:50~23:59였다. 내 주변 첫 화면과 같은 구간(src/lib/glance.ts)으로 맞췄다
    expect(glanceQuery(TODAY, '23:50')).toEqual({ date: TODAY, stayStart: '23:40', stayEnd: '23:50' });
    expect(glanceQuery(TODAY, '23:58')).toEqual({ date: TODAY, stayStart: '23:40', stayEnd: '23:50' });
  });
});

describe('glanceRangeText', () => {
  const text = (time: string) => glanceRangeText(glanceQuery(TODAY, time), time);

  it.each([
    ['13:17', '지금(13:10)부터 2시간 안, 즉 15:10까지'],
    ['21:50', '지금(21:50)부터 2시간 안, 즉 23:50까지'], // 2시간이 정확히 23:50에 닿는 마지막 시각
    ['21:59', '지금(21:50)부터 2시간 안, 즉 23:50까지'],
  ])('2시간을 다 잡으면 %s → %s', (time, expected) => {
    expect(text(time)).toBe(expected);
  });

  it.each([
    ['22:00', '지금(22:00)부터 오늘 23:50까지'],
    ['22:30', '지금(22:30)부터 오늘 23:50까지'],
    ['23:40', '지금(23:40)부터 오늘 23:50까지'],
    ['23:49', '지금(23:40)부터 오늘 23:50까지'],
  ])('23:50에 걸려 짧아지면 2시간이라 하지 않는다 %s → %s', (time, expected) => {
    expect(text(time)).toBe(expected);
  });

  it.each(['23:50', '23:55', '23:59'])('23:50 이후(%s)는 구간을 당겼으므로 지금이라 하지 않는다', (time) => {
    expect(text(time)).toBe('오늘 마지막 구간(23:40~23:50)에');
  });
});

describe('laterEntry', () => {
  it('가능이고 입장 시각이 시작보다 뒤면 그 시각', () => {
    expect(laterEntry({ result: 'possible', entryTime: '14:00' }, '13:10')).toBe('14:00');
  });

  it('지금 바로 들어갈 수 있으면 null', () => {
    expect(laterEntry({ result: 'possible', entryTime: '13:05' }, '13:05')).toBeNull();
    expect(laterEntry({ result: 'possible', entryTime: '09:30' }, '13:05')).toBeNull();
    expect(laterEntry({ result: 'possible' }, '13:05')).toBeNull();
  });

  it('가능이 아니면 입장 시각이 있어도 null', () => {
    expect(laterEntry({ result: 'impossible', entryTime: '19:00' }, '13:05')).toBeNull();
    expect(laterEntry({ result: 'unknown', entryTime: '19:00' }, '13:05')).toBeNull();
  });
});

describe('splitSaved', () => {
  const item = (id: string, savedAt: string, exhibition: object = GONE_SNAPSHOT) =>
    normalizeSavedItem({ exhibitionId: id, savedAt, exhibition }, nothing)!;

  it('진행 중인 전시는 곧 끝나는 순, 끝났거나 빠진 전시는 찜한 순으로 나눈다', () => {
    const late = entryOf('auto-seoul-300', '늦게 끝남', '2027-03-01');
    const soon = entryOf('auto-seoul-400', '곧 끝남', '2026-11-30');
    const over = entryOf('auto-seoul-500', '카탈로그에 남은 끝난 전시', '2026-11-20');
    const catalog = new Map([late, soon, over].map((e) => [e.exhibition.id, e]));
    const items = [
      item('auto-seoul-300', '2026-11-01T00:00:00.000Z'),
      item('auto-seoul-999', '2026-11-02T00:00:00.000Z'),
      item('auto-seoul-400', '2026-11-03T00:00:00.000Z'),
      item('auto-seoul-500', '2026-11-04T00:00:00.000Z'),
      item('auto-seoul-998', '2026-11-05T00:00:00.000Z', { ...GONE_SNAPSHOT, end: null }),
    ];

    const { active, gone } = splitSaved(items, (id) => catalog.get(id), TODAY);
    expect(active.map((r) => [r.exhibition.title, r.status])).toEqual([
      ['곧 끝남', 'active'],
      ['늦게 끝남', 'active'],
    ]);
    expect(gone.map((r) => [r.item.exhibitionId, r.status])).toEqual([
      ['auto-seoul-999', 'ended'],
      ['auto-seoul-500', 'ended'],
      ['auto-seoul-998', 'unlisted'],
    ]);
  });

  it('카탈로그에 있으면 최신 정보를, 없으면 찜할 때의 사본을 보여 준다', () => {
    const { active, gone } = splitSaved(
      [item(A.exhibition.id, NOW.toISOString(), { ...GONE_SNAPSHOT, title: '예전 제목' }), item('auto-seoul-999', NOW.toISOString())],
      lookup,
      TODAY,
    );
    expect(active[0]).toMatchObject({ entry: A, exhibition: snapshotOf(A) });
    expect(gone[0]).toMatchObject({ entry: undefined, exhibition: GONE_SNAPSHOT });
  });

  it('종료일을 모르는 진행 중 전시는 맨 뒤, 같으면 찜한 순', () => {
    const noEnd = entryOf('auto-seoul-600', '종료일 모름', '');
    const same1 = entryOf('auto-seoul-700', '같은 날 1', '2026-12-31');
    const same2 = entryOf('auto-seoul-800', '같은 날 2', '2026-12-31');
    const catalog = new Map([noEnd, same1, same2].map((e) => [e.exhibition.id, e]));
    const items = ['auto-seoul-600', 'auto-seoul-800', 'auto-seoul-700'].map((id) => item(id, NOW.toISOString()));

    const { active } = splitSaved(items, (id) => catalog.get(id), TODAY);
    expect(active.map((r) => r.exhibition.title)).toEqual(['같은 날 2', '같은 날 1', '종료일 모름']);
  });
});
