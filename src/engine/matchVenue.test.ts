import { describe, it, expect } from 'vitest';
import type { Venue } from '../types';
import { matchVenue, normalizePlaceName, VENUE_MATCH_RADIUS_M } from './matchVenue';
import { calculateDistance } from './distance';

function venue(id: string, name: string, aliases: string[], lat: number, lng: number): Venue {
  return {
    id,
    name,
    aliases,
    gu: '종로구',
    type: '박물관',
    lat,
    lng,
    representative: true,
    source: 'test',
    verified: '2026-11-16',
  };
}

// 위도 0.0001도 ≈ 11m
const CRAFT = venue('venue-craft', '서울공예박물관', ['서울공예박물관'], 37.5778, 126.9934);
const SEMA = venue('venue-sema', '서울시립미술관(SeMA)', ['서울시립미술관', 'SeMA'], 37.5641, 126.9738);
const HISTORY = venue('venue-history', '서울역사박물관', ['서울역사박물관'], 37.5704, 126.9706);
const VENUES = [CRAFT, SEMA, HISTORY];

describe('VENUE_MATCH_RADIUS_M', () => {
  it('100m', () => {
    expect(VENUE_MATCH_RADIUS_M).toBe(100);
  });
});

describe('normalizePlaceName', () => {
  it('층·관·동 표기와 공백을 지운다', () => {
    expect(normalizePlaceName('서울공예박물관 전시1동  3층 기획전시실')).toBe('서울공예박물관기획전시실');
    expect(normalizePlaceName('서울시립미술관 서소문본관 지하1층 세마홀')).toBe('서울시립미술관서소문세마홀');
  });

  it('괄호와 괄호 안 내용을 지운다', () => {
    expect(normalizePlaceName('서울시립미술관(SeMA)')).toBe('서울시립미술관');
    expect(normalizePlaceName('어느 갤러리 (B1) 2관')).toBe('어느갤러리');
  });

  it('B1, 2F 같은 표기도 지운다', () => {
    expect(normalizePlaceName('어느 갤러리 B1')).toBe('어느갤러리');
    expect(normalizePlaceName('어느 갤러리 2F')).toBe('어느갤러리');
  });
});

describe('matchVenue — 규칙 1: links', () => {
  it('placeName 원문이 links에 있으면 그 값', () => {
    const r = matchVenue({ placeName: '공예관 어딘가' }, VENUES, { '공예관 어딘가': 'venue-craft' });
    expect(r).toEqual({ venueId: 'venue-craft', by: 'link' });
  });

  it('links 값이 null이면 이름이 맞아도 연결하지 않음', () => {
    const r = matchVenue({ placeName: '서울공예박물관 3층' }, VENUES, { '서울공예박물관 3층': null });
    expect(r).toEqual({ venueId: null, by: 'link' });
  });

  it('links 키는 원문 그대로 비교한다 (정규화하지 않음)', () => {
    const r = matchVenue({ placeName: '서울공예박물관  3층' }, VENUES, { '서울공예박물관 3층': null });
    expect(r).toEqual({ venueId: 'venue-craft', by: 'alias' });
  });

  it('links에 없는 키는 프로토타입 속성과 헷갈리지 않는다', () => {
    const r = matchVenue({ placeName: 'toString' }, VENUES);
    expect(r).toEqual({ venueId: null, by: null });
  });
});

describe('matchVenue — 규칙 3: 이름(alias)', () => {
  it('정규화 예: 공예박물관 전시1동 3층', () => {
    const r = matchVenue({ placeName: '서울공예박물관 전시1동  3층 기획전시실' }, VENUES);
    expect(r).toEqual({ venueId: 'venue-craft', by: 'alias' });
  });

  it('정규화 예: 서소문본관 지하1층', () => {
    const r = matchVenue({ placeName: '서울시립미술관 서소문본관 지하1층 세마홀' }, VENUES);
    expect(r).toEqual({ venueId: 'venue-sema', by: 'alias' });
  });

  it('시설 name의 괄호도 지우고 비교한다', () => {
    const sema = venue('v', '서울시립미술관(SeMA)', [], 37.5641, 126.9738);
    expect(matchVenue({ placeName: '서울시립미술관 1층' }, [sema])).toEqual({ venueId: 'v', by: 'alias' });
  });

  it('여러 시설이 맞으면 가장 긴 이름이 맞은 시설', () => {
    const short = venue('short', '공예박물관', [], 37.5778, 126.9934);
    const long = venue('long', '서울공예박물관', [], 37.5778, 126.9934);
    expect(matchVenue({ placeName: '서울공예박물관 3층' }, [short, long]).venueId).toBe('long');
    expect(matchVenue({ placeName: '서울공예박물관 3층' }, [long, short]).venueId).toBe('long');
  });

  it('긴 alias가 맞은 시설이 짧은 name이 맞은 시설보다 우선', () => {
    const a = venue('a', '미술관', [], 37.5778, 126.9934);
    const b = venue('b', 'B', ['시립미술관'], 37.5778, 126.9934);
    expect(matchVenue({ placeName: '시립미술관' }, [a, b]).venueId).toBe('b');
  });

  it('전시 좌표가 100m 이내면 연결', () => {
    const r = matchVenue({ placeName: '서울공예박물관', lat: 37.5785, lng: 126.9934 }, VENUES);
    expect(r).toEqual({ venueId: 'venue-craft', by: 'alias' });
  });

  it('이름은 맞지만 좌표가 100m 밖이면 연결 안 됨', () => {
    const ex = { placeName: '서울공예박물관', lat: 37.5788, lng: 126.9934 };
    expect(calculateDistance(ex as { lat: number; lng: number }, CRAFT)).toBeGreaterThan(100);
    expect(matchVenue(ex, VENUES)).toEqual({ venueId: null, by: null });
  });

  it('"서울역사박물관 딜쿠샤": 이름은 맞지만 위치가 멀면 걸러짐', () => {
    // 딜쿠샤(종로구 행촌동)는 서울역사박물관에서 1km 남짓 떨어져 있다
    const ex = { placeName: '서울역사박물관 딜쿠샤', lat: 37.5747, lng: 126.9631 };
    expect(matchVenue(ex, VENUES)).toEqual({ venueId: null, by: null });
  });

  it('"서울역사박물관 딜쿠샤": 좌표가 없으면 이름대로 연결', () => {
    expect(matchVenue({ placeName: '서울역사박물관 딜쿠샤' }, VENUES)).toEqual({
      venueId: 'venue-history',
      by: 'alias',
    });
  });

  it('전시 좌표가 null·NaN·0·반쪽이면 좌표 조건 없이 연결', () => {
    const base = { placeName: '서울공예박물관' };
    const cases = [
      { lat: null, lng: null },
      { lat: NaN, lng: NaN },
      { lat: 0, lng: 0 },
      { lat: null, lng: 126.9 }, // lat만 null
      { lat: 37.0, lng: NaN },
      { lat: Infinity, lng: 126.9 },
    ];
    for (const c of cases) {
      expect(matchVenue({ ...base, ...c }, VENUES)).toEqual({ venueId: 'venue-craft', by: 'alias' });
    }
  });

  it('이름이 비거나 정규화 후 빈 문자열이면 이름 매칭을 하지 않음', () => {
    const blank = venue('blank', '(임시)', ['3층'], 37.5778, 126.9934);
    expect(matchVenue({ placeName: '아무데나' }, [blank])).toEqual({ venueId: null, by: null });
    expect(matchVenue({ placeName: '' }, VENUES)).toEqual({ venueId: null, by: null });
    expect(matchVenue({}, VENUES)).toEqual({ venueId: null, by: null });
  });
});

describe('matchVenue — 규칙 4: 좌표', () => {
  it('이름으로 못 찾았고 100m 이내 시설이 하나면 연결', () => {
    const r = matchVenue({ placeName: '어느 전시장', lat: 37.5779, lng: 126.9935 }, VENUES);
    expect(r).toEqual({ venueId: 'venue-craft', by: 'coord' });
  });

  it('100m 이내 시설이 둘 이상이면 연결 안 함', () => {
    const twin = venue('twin', '옆 건물', [], 37.5779, 126.9934);
    const r = matchVenue({ placeName: '어느 전시장', lat: 37.5778, lng: 126.9934 }, [...VENUES, twin]);
    expect(r).toEqual({ venueId: null, by: null });
  });

  it('100m 이내 시설이 없으면 연결 안 함', () => {
    const r = matchVenue({ placeName: '어느 전시장', lat: 37.6, lng: 127.0 }, VENUES);
    expect(r).toEqual({ venueId: null, by: null });
  });

  it('placeName이 없어도 좌표로 연결', () => {
    expect(matchVenue({ lat: 37.5778, lng: 126.9934 }, VENUES)).toEqual({ venueId: 'venue-craft', by: 'coord' });
  });

  it('좌표가 null·NaN·반쪽이면 좌표 매칭을 하지 않음', () => {
    for (const c of [
      { lat: null, lng: null },
      { lat: NaN, lng: 126.9934 },
      { lat: null, lng: 126.9934 },
      { lat: 37.5778, lng: undefined },
      { lat: 0, lng: 0 },
    ]) {
      expect(matchVenue({ placeName: '어느 전시장', ...c }, VENUES)).toEqual({ venueId: null, by: null });
    }
  });

  it('좌표가 잘못된 시설은 좌표 매칭 후보에서 빠진다', () => {
    const broken = venue('broken', '깨진 시설', [], NaN, NaN);
    const r = matchVenue({ placeName: '어느 전시장', lat: 37.5778, lng: 126.9934 }, [...VENUES, broken]);
    expect(r).toEqual({ venueId: 'venue-craft', by: 'coord' });
  });
});
