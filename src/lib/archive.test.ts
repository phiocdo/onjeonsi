import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import exportSchema from '../../schema/personal-records-export.schema.json';
import type { Exhibition, Venue } from '../types';
import type { ArchiveData } from '../types/records';
import type { CatalogEntry } from './catalog';
import {
  ARCHIVE_KEY,
  LEGACY_INTERESTS_KEY,
  LEGACY_RECORDS_KEY,
  UNKNOWN_TITLE,
  buildExport,
  clearArchive,
  createRecord,
  exportFileName,
  isCalendarDate,
  loadArchive,
  normalizeRecord,
  readVisitedIds,
  saveArchive,
  snapshotOf,
  viewOf,
  type ArchiveStorage,
  type CatalogLookup,
} from './archive';

// ─── fixture ─────────────────────────────────────────────

/** 메모리 저장소. fail을 켜면 setItem이 예외를 던진다 (용량 초과 흉내) */
class MemoryStorage implements ArchiveStorage {
  data = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

const VENUE = { id: 'venue-sema', name: '서울시립미술관' } as Venue;

const EXHIBITION: Exhibition = {
  id: 'auto-seoul-100',
  venueId: 'venue-sema',
  title: '빛의 정원',
  start: '2026-11-01',
  end: '2026-12-31',
  field: '전시/미술',
  placeName: '서울시립미술관 서소문본관',
  imageUrl: 'https://example.com/a.jpg',
};

const ENTRY = {
  exhibition: EXHIBITION,
  venue: VENUE,
  match: { venueId: 'venue-sema', by: 'link' },
  resolved: {},
} as unknown as CatalogEntry;

const lookup: CatalogLookup = (id) => (id === EXHIBITION.id ? ENTRY : undefined);
const nothing: CatalogLookup = () => undefined;
const NOW = new Date('2026-11-21T03:00:00.000Z');
const TODAY = '2026-11-21';

function validRecord() {
  const r = createRecord({ entry: ENTRY, date: '2026-11-20', rating: 5, visitMinutes: 70, note: ' 좋았다 ', shared: true }, NOW, 'r1');
  if (!r) throw new Error('fixture 기록이 잘못됨');
  return r;
}

function v2(records: unknown[], interests: unknown = []): string {
  return JSON.stringify({ version: 2, records, interests });
}

// ─── 날짜 ─────────────────────────────────────────────

describe('isCalendarDate', () => {
  it('달력에 있는 날짜만 참', () => {
    expect(isCalendarDate('2026-11-21')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-11-31')).toBe(false);
    expect(isCalendarDate('2026/11/21')).toBe(false);
    expect(isCalendarDate(20261121)).toBe(false);
  });
});

// ─── 기록 만들기 ─────────────────────────────────────────

describe('snapshotOf / createRecord', () => {
  it('카탈로그 항목에서 전시 정보 사본을 만든다', () => {
    expect(snapshotOf(ENTRY)).toEqual({
      title: '빛의 정원',
      venueName: '서울시립미술관',
      venueId: 'venue-sema',
      field: '전시/미술',
      imageUrl: 'https://example.com/a.jpg',
      start: '2026-11-01',
      end: '2026-12-31',
    });
  });

  it('시설이 없고 빈 값이면 null로 둔다', () => {
    const bare = { ...ENTRY, venue: null, exhibition: { ...EXHIBITION, field: '', imageUrl: undefined, placeName: undefined, end: '' } } as CatalogEntry;
    expect(snapshotOf(bare)).toMatchObject({ venueName: null, venueId: null, field: null, imageUrl: null, end: null });
  });

  it('메모 앞뒤 공백을 지우고 createdAt을 넣는다', () => {
    const r = validRecord();
    expect(r).toMatchObject({ id: 'r1', exhibitionId: 'auto-seoul-100', note: '좋았다', createdAt: NOW.toISOString() });
  });

  it('관람 시간 소수는 반올림한다', () => {
    const r = createRecord({ entry: ENTRY, date: '2026-11-20', rating: 4, visitMinutes: 45.7, note: '', shared: false }, NOW);
    expect(r?.visitMinutes).toBe(46);
  });

  it('별점·관람 시간·날짜가 틀리면 null', () => {
    const base = { entry: ENTRY, date: '2026-11-20', rating: 5, visitMinutes: 70, note: '', shared: false };
    expect(createRecord({ ...base, rating: 6 }, NOW)).toBeNull();
    expect(createRecord({ ...base, visitMinutes: 5 }, NOW)).toBeNull();
    expect(createRecord({ ...base, date: '2026/11/20' }, NOW)).toBeNull();
    expect(createRecord({ ...base, date: '2026-02-30' }, NOW)).toBeNull();
  });
});

// ─── 읽기·옮기기 ─────────────────────────────────────────

describe('loadArchive', () => {
  it('아무것도 없으면 빈 아카이브', () => {
    expect(loadArchive(new MemoryStorage(), lookup)).toEqual({ data: { version: 2, records: [], interests: [] }, saveFailed: false });
  });

  it('저장한 것을 그대로 읽는다', () => {
    const s = new MemoryStorage();
    const data: ArchiveData = { version: 2, records: [validRecord()], interests: ['전시/미술'] };
    expect(saveArchive(s, data)).toBe(true);
    expect(loadArchive(s, lookup).data).toEqual(data);
  });

  it('v1 키를 v2로 옮기고 v1 키를 지운다', () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_RECORDS_KEY, JSON.stringify([
      { id: '1763600000000', exhibitId: 'auto-seoul-100', date: '2026-11-20', rating: 4, time: 90, note: '메모', shared: false },
      { id: '1763600000001', exhibitId: 'auto-seoul-999', date: '2026-10-01', rating: 3, time: 60.4, note: '', shared: true },
    ]));
    s.setItem(LEGACY_INTERESTS_KEY, JSON.stringify(['전시/미술', '전시/미술', '']));

    const { data, saveFailed } = loadArchive(s, lookup);

    expect(saveFailed).toBe(false);
    expect(data.interests).toEqual(['전시/미술']);
    expect(data.records).toHaveLength(2);
    // 카탈로그에 있는 전시: 사본을 카탈로그에서 채운다
    expect(data.records[0]).toMatchObject({
      exhibitionId: 'auto-seoul-100',
      visitMinutes: 90,
      exhibition: { title: '빛의 정원', venueId: 'venue-sema', end: '2026-12-31' },
      createdAt: new Date(1763600000000).toISOString(),
    });
    // 카탈로그에 없는 전시(끝난 전시): 버리지 않고 알 수 없는 전시로 둔다. 소수 시간은 반올림
    expect(data.records[1]).toMatchObject({
      exhibitionId: 'auto-seoul-999',
      exhibition: { title: UNKNOWN_TITLE, end: null },
      visitMinutes: 60,
      shared: true,
    });

    expect(s.getItem(LEGACY_RECORDS_KEY)).toBeNull();
    expect(s.getItem(LEGACY_INTERESTS_KEY)).toBeNull();
    expect(JSON.parse(s.getItem(ARCHIVE_KEY) ?? 'null')).toEqual(data);
  });

  it('옮긴 것을 저장하지 못하면 saveFailed이고 v1 키를 남긴다. 나중에 저장에 성공하면 v1 키를 지운다', () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_RECORDS_KEY, JSON.stringify([{ id: '1', exhibitId: 'auto-seoul-100', date: '2026-11-20', rating: 4, time: 90, note: '', shared: false }]));
    s.fail = true;
    const { data, saveFailed } = loadArchive(s, lookup);
    expect(saveFailed).toBe(true);
    expect(data.records).toHaveLength(1);
    expect(s.getItem(LEGACY_RECORDS_KEY)).not.toBeNull();

    s.fail = false;
    expect(saveArchive(s, data)).toBe(true);
    expect(s.getItem(LEGACY_RECORDS_KEY)).toBeNull();
  });

  it('새 키의 version이 2가 아니면 새 키를 쓰지 않고 v1 키를 옮긴다', () => {
    const s = new MemoryStorage();
    s.setItem(ARCHIVE_KEY, '{}');
    s.setItem(LEGACY_INTERESTS_KEY, JSON.stringify(['전시/미술']));
    expect(loadArchive(s, lookup).data.interests).toEqual(['전시/미술']);
  });

  it('카탈로그에 있으면 저장된 사본을 최신 정보로 고친다', () => {
    const s = new MemoryStorage();
    const old = { ...validRecord(), exhibition: { ...validRecord().exhibition, title: '옛 제목', venueId: null } };
    s.setItem(ARCHIVE_KEY, v2([old]));
    expect(loadArchive(s, lookup).data.records[0].exhibition).toMatchObject({ title: '빛의 정원', venueId: 'venue-sema' });
  });

  it('카탈로그에서 빠진 전시는 저장된 사본을 쓴다', () => {
    const s = new MemoryStorage();
    saveArchive(s, { version: 2, records: [validRecord()], interests: [] });
    expect(loadArchive(s, nothing).data.records[0].exhibition.title).toBe('빛의 정원');
  });

  it('깨진 JSON이면 빈 아카이브', () => {
    const s = new MemoryStorage();
    s.setItem(ARCHIVE_KEY, '{oops');
    expect(loadArchive(s, lookup).data.records).toEqual([]);
  });

  it('잘못된 기록과 id가 겹치는 기록은 버린다', () => {
    const s = new MemoryStorage();
    const ok = validRecord();
    s.setItem(ARCHIVE_KEY, v2(
      [ok, { ...ok, note: '중복' }, { ...ok, id: 'r2', rating: 0 }, { ...ok, id: 'r3', visitMinutes: 999 }, { ...ok, id: 'r4', date: '2026-02-30' }, 'x', null],
      'not-array',
    ));
    const { data } = loadArchive(s, lookup);
    expect(data.records).toEqual([ok]);
    expect(data.interests).toEqual([]);
  });
});

describe('normalizeRecord', () => {
  it('숫자 id·전시 id는 문자열로 바꾼다', () => {
    const r = normalizeRecord({ id: 1763600000000, exhibitId: 18, date: '2026-11-20', rating: 5, time: 80, note: '', shared: false }, lookup);
    expect(r).toMatchObject({ id: '1763600000000', exhibitionId: '18', visitMinutes: 80 });
  });

  it('createdAt은 ISO 8601로 맞추고, 읽을 수 없으면 관람일 0시(서울)로 둔다', () => {
    const base = { id: 'a', exhibitionId: 'x', date: '2026-11-20', rating: 5, visitMinutes: 80, note: '', shared: false };
    expect(normalizeRecord({ ...base, createdAt: '2026/11/20 10:00' }, nothing)?.createdAt).toBe(new Date('2026/11/20 10:00').toISOString());
    expect(normalizeRecord({ ...base, createdAt: 'garbage' }, nothing)?.createdAt).toBe('2026-11-19T15:00:00.000Z');
    expect(normalizeRecord(base, nothing)?.createdAt).toBe('2026-11-19T15:00:00.000Z');
  });
});

// ─── 화면 표시 ───────────────────────────────────────────

describe('viewOf', () => {
  it('카탈로그에 있으면 listed', () => {
    expect(viewOf(validRecord(), ENTRY, TODAY)).toMatchObject({ title: '빛의 정원', status: 'listed' });
  });

  it('카탈로그에 없고 종료일이 지났으면 ended', () => {
    const r = { ...validRecord(), exhibition: { ...validRecord().exhibition, end: '2026-11-20' } };
    expect(viewOf(r, undefined, TODAY)).toMatchObject({ title: '빛의 정원', status: 'ended' });
  });

  it('카탈로그에 없고 종료일을 모르거나 안 지났으면 unlisted', () => {
    const r = validRecord();
    expect(viewOf(r, undefined, TODAY).status).toBe('unlisted');
    expect(viewOf({ ...r, exhibition: { ...r.exhibition, end: null } }, undefined, TODAY).status).toBe('unlisted');
  });
});

// ─── 내보내기·삭제 ───────────────────────────────────────

describe('buildExport / exportFileName', () => {
  const validate = new Ajv({ allErrors: true }).compile(exportSchema);

  it('내보내기 결과가 스키마를 통과한다', () => {
    const out = buildExport({ version: 2, records: [validRecord()], interests: ['전시/미술'] }, NOW);
    expect(out.exportedAt).toBe(NOW.toISOString());
    expect(validate(out), JSON.stringify(validate.errors)).toBe(true);
  });

  it('옮긴 v1 기록(알 수 없는 전시, 소수 시간)도 스키마를 통과한다', () => {
    const s = new MemoryStorage();
    s.setItem(LEGACY_RECORDS_KEY, JSON.stringify([{ id: '1763600000001', exhibitId: 'gone', date: '2026-10-01', rating: 3, time: 60.4, note: '', shared: true }]));
    const out = buildExport(loadArchive(s, lookup).data, NOW);
    expect(validate(out), JSON.stringify(validate.errors)).toBe(true);
  });

  it('빈 아카이브도 스키마를 통과한다', () => {
    expect(validate(buildExport({ version: 2, records: [], interests: [] }, NOW))).toBe(true);
  });

  it('스키마는 소수 관람 시간을 막는다', () => {
    const out = buildExport({ version: 2, records: [{ ...validRecord(), visitMinutes: 45.5 }], interests: [] }, NOW);
    expect(validate(out)).toBe(false);
  });

  it('파일 이름은 서울 날짜를 쓴다', () => {
    // UTC 11-20 16:00 = 서울 11-21 01:00
    expect(exportFileName(new Date('2026-11-20T16:00:00.000Z'))).toBe('onjeonsi-archive-2026-11-21.json');
  });
});

describe('readVisitedIds', () => {
  it('v2 기록의 전시 id를 모은다', () => {
    const s = new MemoryStorage();
    s.setItem(ARCHIVE_KEY, v2([validRecord(), { ...validRecord(), id: 'r2', exhibitionId: 'auto-seoul-200' }]));
    expect(readVisitedIds(s)).toEqual(new Set(['auto-seoul-100', 'auto-seoul-200']));
  });

  it('v1 기록도 읽지만 옮기지는 않는다 (저장소를 바꾸지 않음)', () => {
    const s = new MemoryStorage();
    const legacy = JSON.stringify([{ id: '1', exhibitId: 'auto-seoul-100', date: '2026-11-20', rating: 4, time: 90, note: '', shared: false }]);
    s.setItem(LEGACY_RECORDS_KEY, legacy);
    expect(readVisitedIds(s)).toEqual(new Set(['auto-seoul-100']));
    expect(s.getItem(ARCHIVE_KEY)).toBeNull();
    expect(s.getItem(LEGACY_RECORDS_KEY)).toBe(legacy);
  });

  it('아무것도 없으면 빈 집합', () => {
    expect(readVisitedIds(new MemoryStorage()).size).toBe(0);
  });
});

describe('clearArchive', () => {
  it('새 키와 v1 키를 모두 지운다', () => {
    const s = new MemoryStorage();
    s.setItem(ARCHIVE_KEY, '{}');
    s.setItem(LEGACY_RECORDS_KEY, '[]');
    s.setItem(LEGACY_INTERESTS_KEY, '[]');
    expect(clearArchive(s)).toBe(true);
    expect(s.data.size).toBe(0);
    expect(loadArchive(s, lookup).data).toEqual({ version: 2, records: [], interests: [] });
  });
});
