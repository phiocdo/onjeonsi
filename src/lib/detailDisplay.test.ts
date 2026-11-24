import { describe, expect, it } from 'vitest';
import type { Exhibition, ParsedOperatingHours, Venue } from '../types';
import type { ResolvedVenue } from '../engine/judge';
import { REASONS } from '../engine/reasons';
import semaJson from '../../data/venues/venue-sema.json';
import mmcaJson from '../../data/venues/venue-mmca.json';
import exhibitionsJson from '../../data/exhibitions/auto.json';
import { buildCatalog, judgeEntry, type CatalogEntry } from './catalog';
import { detailQuery, entryLastEntryLabel, lastEntryLabel, reasonLines, similarWithJudge } from './detailDisplay';

// 2026-11-22 일요일, 2026-11-23 월요일, 2026-11-27 금요일, 2026-11-24 화요일
const SUN = '2026-11-22';
const MON = '2026-11-23';
const TUE = '2026-11-24';
const FRI = '2026-11-27';

const SEMA = semaJson as unknown as Venue;
const MMCA = mmcaJson as unknown as Venue;
const LISSON = (exhibitionsJson as Exhibition[]).find((e) => e.id === 'auto-seoul-159756')!;

const BASE: Venue = {
  id: 'v',
  name: '가나다미술관',
  aliases: [],
  gu: '종로구',
  type: '미술관',
  lat: 37.57,
  lng: 126.97,
  representative: true,
  source: 'test',
  verified: '2026-11-01',
  hours: {
    tue: { open: '10:00', close: '18:00' },
    wed: { open: '10:00', close: '18:00' },
    thu: { open: '10:00', close: '18:00' },
    fri: { open: '10:00', close: '18:00' },
    sat: { open: '10:00', close: '18:00' },
    sun: { open: '10:00', close: '18:00' },
  },
  closed: { weekday: 'mon' },
} as Venue;

const EX: Exhibition = {
  id: 'ex',
  venueId: '',
  title: '전시',
  start: '2026-01-01',
  end: '2026-12-31',
  placeName: '가나다미술관',
} as Exhibition;

function entryOf(venue: Venue | null, exhibition: Exhibition = EX, flag = true): CatalogEntry {
  return buildCatalog([exhibition], venue ? [venue] : [], { [exhibition.id]: venue ? venue.id : null }, {
    useExhibitionHours: flag,
  })[0];
}

/** 판정 사유의 입장 마감 시각 */
function reasonTime(entry: CatalogEntry, date: string, stayStart: string): string | null {
  const r = judgeEntry(entry, { date, stayStart, stayEnd: '23:59' }, []);
  for (const reason of r.reasons) {
    const m = /^입장 마감\((\d{2}:\d{2})\) 이후입니다$/.exec(reason);
    if (m) return m[1];
  }
  return null;
}

describe('lastEntryLabel: lastEntryBeforeClose (서울시립미술관)', () => {
  const sema = entryOf(SEMA, LISSON);

  it('일요일 → 오늘 17:00 (폐관 1시간 전). 요일별로 달라 "오늘"이 앞에 온다', () => {
    expect(entryLastEntryLabel(sema, SUN, [])).toBe('오늘 17:00 (폐관 1시간 전)');
  });

  it('금요일 → 20:00 (전시 근거 합친 시설에서도 폐관 21:00 − 60분)', () => {
    expect(entryLastEntryLabel(sema, FRI, [])).toBe('오늘 20:00 (폐관 1시간 전)');
  });

  it('월요일 → 오늘 휴관', () => {
    expect(entryLastEntryLabel(sema, MON, [])).toBe('오늘 휴관');
  });

  it('일요일 20시 판정 사유의 입장 마감 시각과 같다', () => {
    const r = judgeEntry(sema, { date: SUN, stayStart: '20:00', stayEnd: '23:59' }, []);
    expect(r.result).toBe('impossible');
    expect(r.basis).toBe('merged');
    expect(r.reasons).toEqual([REASONS.AFTER_LAST_ENTRY('17:00'), REASONS.NOT_ENOUGH_BEFORE_CLOSE]);
    expect(entryLastEntryLabel(sema, SUN, [])).toContain(reasonTime(sema, SUN, '20:00')!);
  });

  it('날짜·시각을 바꿔도 표시 시각이 판정 사유와 같다', () => {
    for (const date of [TUE, FRI, SUN]) {
      const t = reasonTime(sema, date, '22:00');
      expect(t).not.toBeNull();
      expect(entryLastEntryLabel(sema, date, [])).toContain(t!);
    }
  });

  it('공휴일이면 holidayAs(일) 기준이다: 금요일 공휴일 → 17:00', () => {
    expect(entryLastEntryLabel(sema, FRI, [FRI])).toBe('오늘 17:00 (폐관 1시간 전)');
    expect(judgeEntry(sema, { date: FRI, stayStart: '17:30', stayEnd: '23:59' }, [FRI]).reasons[0]).toBe(
      REASONS.AFTER_LAST_ENTRY('17:00'),
    );
  });

  it('요일마다 폐관이 같으면 기준 먼저: 폐관 1시간 전 (17:00)', () => {
    const v = { ...BASE, lastEntryBeforeClose: 60 } as Venue;
    expect(entryLastEntryLabel(entryOf(v), SUN, [])).toBe('폐관 1시간 전 (17:00)');
  });

  it('30분·90분 문구', () => {
    expect(entryLastEntryLabel(entryOf({ ...BASE, lastEntryBeforeClose: 30 } as Venue), SUN, [])).toBe(
      '폐관 30분 전 (17:30)',
    );
    expect(entryLastEntryLabel(entryOf({ ...BASE, lastEntryBeforeClose: 90 } as Venue), SUN, [])).toBe(
      '폐관 1시간 30분 전 (16:30)',
    );
  });

  it('day 인자로 "오늘" 자리를 바꾼다', () => {
    expect(entryLastEntryLabel(sema, SUN, [], '11/22(일)')).toBe('11/22(일) 17:00 (폐관 1시간 전)');
    expect(entryLastEntryLabel(sema, MON, [], '11/23(월)')).toBe('11/23(월) 휴관');
  });
});

describe('lastEntryLabel: lastEntryBeforeClose가 0 (폐관 시각까지)', () => {
  it('요일마다 같으면 폐관 시각까지 (18:00)', () => {
    expect(entryLastEntryLabel(entryOf({ ...BASE, lastEntryBeforeClose: 0 } as Venue), SUN, [])).toBe('폐관 시각까지 (18:00)');
  });

  it('요일별로 다르면 오늘 21:00 (폐관 시각까지)', () => {
    const v = { ...BASE, hours: { ...BASE.hours, wed: { open: '10:00', close: '21:00' } }, lastEntryBeforeClose: 0 } as Venue;
    expect(entryLastEntryLabel(entryOf(v), '2026-11-25', [])).toBe('오늘 21:00 (폐관 시각까지)');
    expect(entryLastEntryLabel(entryOf(v), SUN, [])).toBe('오늘 18:00 (폐관 시각까지)');
  });

  it('N > 0 문구는 그대로', () => {
    expect(entryLastEntryLabel(entryOf({ ...BASE, lastEntryBeforeClose: 60 } as Venue), SUN, [])).toBe('폐관 1시간 전 (17:00)');
  });

  it('국립현대미술관 서울(venue-mmca.json): 수 21:00, 월 18:00', () => {
    const mmca = entryOf(MMCA, { ...EX, placeName: '국립현대미술관 서울' });
    expect(mmca.venue?.id).toBe('venue-mmca');
    expect(entryLastEntryLabel(mmca, '2026-11-25', [])).toBe('오늘 21:00 (폐관 시각까지)');
    expect(entryLastEntryLabel(mmca, MON, [])).toBe('오늘 18:00 (폐관 시각까지)');
    expect(entryLastEntryLabel(mmca, '2026-11-25', [], '11/25(수)')).toBe('11/25(수) 21:00 (폐관 시각까지)');
  });
});

describe('lastEntryLabel: lastEntryByDay', () => {
  it('요일별 값이 다르면 오늘 값만', () => {
    const v: ResolvedVenue = { ...BASE, lastEntryByDay: { sun: '17:00', sat: '16:00' } };
    expect(lastEntryLabel(v, SUN, [])).toBe('오늘 17:00');
  });

  it('lastEntryByDay가 lastEntryBeforeClose보다 우선한다', () => {
    const v: ResolvedVenue = { ...BASE, lastEntryBeforeClose: 60, lastEntryByDay: { sun: '16:30' } };
    expect(lastEntryLabel(v, SUN, [])).toBe('오늘 16:30');
  });

  it('구간이 여러 개인 날은 구간별 값을 잇는다', () => {
    const v: ResolvedVenue = {
      ...BASE,
      intervalsByDay: {
        sun: [
          { open: '10:00', close: '12:00', lastEntry: '11:30' },
          { open: '13:00', close: '18:00', lastEntry: '17:00' },
        ],
      },
    };
    expect(lastEntryLabel(v, SUN, [])).toBe('오늘 11:30 / 17:00');
  });
});

describe('lastEntryLabel: lastEntry 고정', () => {
  it('요일마다 같으면 그 시각', () => {
    expect(entryLastEntryLabel(entryOf({ ...BASE, lastEntry: '17:30' } as Venue), SUN, [])).toBe('17:30');
  });

  it('폐관보다 늦게 적힌 날은 판정처럼 폐관 시각으로 줄인다', () => {
    const v = {
      ...BASE,
      lastEntry: '17:30',
      hours: { ...BASE.hours, sat: { open: '10:00', close: '17:00' } },
    } as Venue;
    const e = entryOf(v);
    expect(entryLastEntryLabel(e, '2026-11-28', [])).toBe('오늘 17:00');
    expect(reasonTime(e, '2026-11-28', '17:10')).toBe('17:00');
    expect(entryLastEntryLabel(e, SUN, [])).toBe('오늘 17:30');
  });
});

describe('lastEntryLabel: 정보 없음', () => {
  it('입장 마감이 없으면 폐관 기준으로 판정한다고 보인다', () => {
    expect(entryLastEntryLabel(entryOf(BASE), SUN, [])).toBe('정보 없음 (폐관 시각 기준으로 판정)');
  });

  it('형식 오류(MISSING_LAST_ENTRY)', () => {
    expect(entryLastEntryLabel(entryOf({ ...BASE, lastEntry: '5시' } as Venue), SUN, [])).toBe('정보 없음 (형식 오류)');
  });

  it('시설 없음·운영 시간 없음 → 정보 없음', () => {
    expect(entryLastEntryLabel(entryOf(null), SUN, [])).toBe('정보 없음');
    expect(lastEntryLabel({ ...BASE, hours: {} }, SUN, [])).toBe('정보 없음');
  });
});

describe('lastEntryLabel: 휴관', () => {
  it('정기 휴관 요일·지정 휴관일', () => {
    expect(entryLastEntryLabel(entryOf(BASE), MON, [])).toBe('오늘 휴관');
    const v = { ...BASE, closed: { weekday: 'mon', dates: [SUN] } } as Venue;
    expect(entryLastEntryLabel(entryOf(v), SUN, [])).toBe('오늘 휴관');
  });

  it('전시가 그날 확실히 쉬면(날짜 예외) 휴관', () => {
    const hours: ParsedOperatingHours = {
      scheduleType: 'scheduled',
      weekdays: {
        sun: { isOpen: true, intervals: [{ open: '10:00', close: '18:00' }] },
      },
      holiday: null,
      exceptions: [{ date: SUN, schedule: { isOpen: false, intervals: [] } }],
    } as unknown as ParsedOperatingHours;
    const e = entryOf(BASE, { ...EX, operatingHours: hours });
    expect(judgeEntry(e, { date: SUN, stayStart: '10:00', stayEnd: '23:59' }, []).result).toBe('impossible');
    expect(entryLastEntryLabel(e, SUN, [])).toBe('오늘 휴관');
  });
});

describe('lastEntryLabel: 전시 근거 합친 경우', () => {
  const hours = {
    scheduleType: 'scheduled',
    weekdays: {
      sat: { isOpen: true, intervals: [{ open: '10:00', close: '18:00', lastAdmission: '16:00' }] },
      sun: { isOpen: true, intervals: [{ open: '10:00', close: '17:00' }] },
    },
    holiday: null,
    exceptions: [],
  } as unknown as ParsedOperatingHours;

  it('시설 lastEntryBeforeClose와 전시 lastAdmission 중 이른 값', () => {
    const e = entryOf({ ...BASE, lastEntryBeforeClose: 60 } as Venue, { ...EX, operatingHours: hours });
    // 토: min(18:00−60=17:00, 16:00) = 16:00 (기준 문구 없음)
    expect(entryLastEntryLabel(e, '2026-11-28', [])).toBe('오늘 16:00');
    expect(reasonTime(e, '2026-11-28', '16:30')).toBe('16:00');
    // 일: 합친 폐관 17:00, 시설 기준 17:00(=18:00−60)이 폐관과 같아 17:00
    expect(entryLastEntryLabel(e, SUN, [])).toBe('오늘 17:00');
    expect(reasonTime(e, SUN, '17:00')).toBe(null); // 17:00 입장은 마감 전(같은 시각) → 폐관 사유만
    // 화: 전시 근거 없음 → 시설 폐관 18:00 − 60
    expect(entryLastEntryLabel(e, TUE, [])).toBe('오늘 17:00 (폐관 1시간 전)');
    expect(reasonTime(e, TUE, '17:30')).toBe('17:00');
  });

  it('플래그 off면 시설만', () => {
    const e = entryOf({ ...BASE, lastEntryBeforeClose: 60 } as Venue, { ...EX, operatingHours: hours }, false);
    expect(entryLastEntryLabel(e, '2026-11-28', [])).toBe('폐관 1시간 전 (17:00)');
  });

  it('시설 없이 전시만(basis exhibition)', () => {
    const e = entryOf(null, { ...EX, operatingHours: hours });
    expect(judgeEntry(e, { date: SUN, stayStart: '10:00', stayEnd: '23:59' }, []).basis).toBe('exhibition');
    expect(entryLastEntryLabel(e, '2026-11-28', [])).toBe('오늘 16:00');
    expect(entryLastEntryLabel(e, SUN, [])).toBe('정보 없음 (폐관 시각 기준으로 판정)');
    expect(entryLastEntryLabel(e, TUE, [])).toBe('정보 없음');
  });
});

describe('reasonLines', () => {
  it('사유마다 한 줄, 근거는 마지막 줄에 한 번', () => {
    expect(reasonLines({ reasons: [REASONS.AFTER_LAST_ENTRY('17:00'), REASONS.NOT_ENOUGH_BEFORE_CLOSE], basis: 'merged' })).toEqual([
      '입장 마감(17:00) 이후입니다',
      '폐관 전까지 관람 시간이 부족합니다 · 시설·전시 안내 기준',
    ]);
  });

  it('사유 하나', () => {
    expect(reasonLines({ reasons: [REASONS.CLOSED_WEEKDAY('월')], basis: 'venue' })).toEqual(['월요일 휴관입니다 · 시설 안내 기준']);
  });

  it('사유 없음(가능) → 근거만, 근거도 없으면 []', () => {
    expect(reasonLines({ reasons: [], basis: 'exhibition' })).toEqual(['전시 안내 기준']);
    expect(reasonLines({ reasons: [REASONS.MISSING_VENUE] })).toEqual(['시설 정보가 없습니다']);
    expect(reasonLines({ reasons: [] })).toEqual([]);
  });
});

describe('detailQuery: 상세 창 판정 조건', () => {
  const NOW_MON = { date: MON, time: '14:00' };

  it('조건 없음 → 오늘 지금 ~ 23:59', () => {
    expect(detailQuery(undefined, NOW_MON)).toEqual({ date: MON, stayStart: '14:00', stayEnd: '23:59' });
    expect(detailQuery(null, NOW_MON)).toEqual({ date: MON, stayStart: '14:00', stayEnd: '23:59' });
  });

  it('날짜만 있음 → 그 날짜, 시각은 상세 창 기본값(지금 ~ 23:59)', () => {
    expect(detailQuery({ date: MON }, NOW_MON)).toEqual({ date: MON, stayStart: '14:00', stayEnd: '23:59' });
    expect(detailQuery({ date: SUN }, NOW_MON)).toEqual({ date: SUN, stayStart: '14:00', stayEnd: '23:59' });
  });

  it('다른 날짜 + 시간대 → 그대로 쓴다', () => {
    expect(detailQuery({ date: FRI, stayStart: '16:00', stayEnd: '17:30' }, NOW_MON)).toEqual({
      date: FRI,
      stayStart: '16:00',
      stayEnd: '17:30',
    });
  });

  it('한쪽만 있으면 빈 쪽만 기본값으로 채운다', () => {
    expect(detailQuery({ date: FRI, stayStart: '16:00' }, NOW_MON)).toEqual({ date: FRI, stayStart: '16:00', stayEnd: '23:59' });
    expect(detailQuery({ date: FRI, stayEnd: '17:30' }, NOW_MON)).toEqual({ date: FRI, stayStart: '14:00', stayEnd: '17:30' });
  });

  it('결과를 다시 넣어도 같다(비슷한 전시 카드를 눌러도 기준이 바뀌지 않음)', () => {
    const q = detailQuery({ date: SUN, stayStart: '10:00', stayEnd: '12:00' }, NOW_MON);
    expect(detailQuery(q, { date: TUE, time: '09:00' })).toEqual(q);
  });
});

describe('similarWithJudge: 상세 창과 같은 조건으로 비슷한 전시를 판정', () => {
  // BASE: 월요일 휴관, 화~일 10:00~18:00. 모두 '수묵' 태그를 공유한다
  const ex = (id: string, title: string, start = '2026-11-01', end = '2026-12-31'): Exhibition =>
    ({ id, venueId: '', title, start, end, placeName: '가나다미술관' }) as Exhibition;
  const list = [ex('t', '수묵 산수'), ex('a', '수묵 풍경'), ex('b', '수묵 인물'), ex('late', '수묵 신작', TUE)];
  const catalog = buildCatalog(list, [BASE], Object.fromEntries(list.map((e) => [e.id, BASE.id])));
  const target = catalog[0];
  const NOW_MON = { date: MON, time: '14:00' };
  const ids = (cards: { entry: CatalogEntry }[]) => cards.map((c) => c.entry.exhibition.id).sort();

  it('조건 없음 → 오늘(월, 휴관) 지금 기준으로 판정한다', () => {
    const q = detailQuery(undefined, NOW_MON);
    const cards = similarWithJudge(target, catalog, q, []);
    expect(ids(cards)).toEqual(['a', 'b']);
    for (const c of cards) {
      expect(c.judge).toEqual(judgeEntry(c.entry, { date: MON, stayStart: '14:00', stayEnd: '23:59' }, []));
      expect(c.judge.result).toBe('impossible');
    }
  });

  it('다른 날짜 + 시간대 → 그 조건으로 판정하고, 상세 창 판정과 같은 조건이다', () => {
    const q = detailQuery({ date: SUN, stayStart: '10:00', stayEnd: '12:00' }, NOW_MON);
    const cards = similarWithJudge(target, catalog, q, []);
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(c.judge.result).toBe('possible');
      expect(c.judge).toEqual(judgeEntry(c.entry, q, []));
    }
    // 같은 날짜라도 시간대가 다르면 결과가 달라진다(시간대까지 같은 조건을 쓴다는 확인)
    const evening = detailQuery({ date: SUN, stayStart: '18:30', stayEnd: '19:00' }, NOW_MON);
    for (const c of similarWithJudge(target, catalog, evening, [])) expect(c.judge.result).toBe('impossible');
  });

  it('후보도 조건 날짜 기준이다: 화요일에 시작하는 전시는 월요일 조건엔 없고 금요일 조건엔 있다', () => {
    expect(ids(similarWithJudge(target, catalog, detailQuery(undefined, NOW_MON), []))).not.toContain('late');
    expect(ids(similarWithJudge(target, catalog, detailQuery({ date: FRI }, NOW_MON), []))).toContain('late');
  });

  it('카드를 눌러 연 상세 창은 같은 조건·같은 판정을 유지한다(입장 마감 표시 날짜도 같다)', () => {
    const q = detailQuery({ date: SUN, stayStart: '10:00', stayEnd: '12:00' }, NOW_MON);
    const card = similarWithJudge(target, catalog, q, [])[0];
    // 카드 → OPEN(id, judge, q) → 다음 상세 창은 detailQuery(q, 지금)을 쓴다
    const next = detailQuery(q, { date: MON, time: '15:00' });
    expect(next).toEqual(q);
    expect(judgeEntry(card.entry, next, [])).toEqual(card.judge);
    expect(entryLastEntryLabel(card.entry, next.date, [])).toBe(entryLastEntryLabel(card.entry, SUN, []));
    // 다음 상세 창의 비슷한 전시도 같은 조건으로 판정한다
    for (const c of similarWithJudge(card.entry, catalog, next, [])) expect(c.judge).toEqual(judgeEntry(c.entry, q, []));
  });
});
