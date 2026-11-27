import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Exhibition, Venue } from '../types';
import { buildCatalog } from './catalog';
import type { KakaoPlace } from './kakaoPlace';
import { kakaoMapLink, searchPlaceLink } from './kakaoMapLink';

const VENUE: Venue = {
  id: 'venue-a',
  name: '가나다미술관',
  aliases: ['가나다'],
  gu: '종로구',
  type: '미술관',
  lat: 37.57,
  lng: 126.97,
  representative: false,
  source: 'https://example.com',
  verified: '2026-11-27',
};

let seq = 0;
function entryOf(exhibition: Partial<Exhibition>, venues: Venue[] = []) {
  const ex: Exhibition = { id: `ex-${++seq}`, venueId: '', title: '전시', start: '2026-01-01', end: '2026-12-31', ...exhibition };
  return buildCatalog([ex], venues)[0];
}

/**
 * window.kakao 자리에 장소 검색만 하는 가짜 SDK를 둔다. 검색어별 결과(없으면 ZERO_RESULT, 'ERROR'면 오류 상태)를 주고
 * 받은 요청을 돌려준다. load: false면 load 콜백을 부르지 않는다(키·도메인 오류 흉내).
 */
function fakeSdk(results: Record<string, KakaoPlace[] | 'ERROR'>, { load = true } = {}) {
  const asked: { query: string; options: unknown }[] = [];
  const services = {
    Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
    Places: class {
      keywordSearch(query: string, done: (data: KakaoPlace[], status: string) => void, options: unknown) {
        asked.push({ query, options });
        const data = results[query] ?? [];
        if (data === 'ERROR') done([], 'ERROR');
        else done(data, data.length ? 'OK' : 'ZERO_RESULT');
      }
    },
  };
  vi.stubGlobal('window', { kakao: { maps: { load: (fn: () => void) => load && fn(), services } } });
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('kakaoMapLink', () => {
  it('시설에 장소 ID가 있으면 장소 페이지', () => {
    const entry = entryOf({ placeName: '가나다미술관 1층' }, [{ ...VENUE, kakaoPlaceId: '123' }]);
    expect(entry.venue?.id).toBe('venue-a');
    expect(kakaoMapLink(entry)).toBe('https://place.map.kakao.com/123');
  });

  it('장소 ID가 없으면 좌표 핀 지도 (시설 이름, 전시 좌표 우선)', () => {
    // matchVenue는 100m 안이어야 연결한다
    const entry = entryOf({ placeName: '가나다미술관 1층', lat: 37.5704, lng: 126.9704 }, [VENUE]);
    expect(entry.venue?.id).toBe('venue-a');
    expect(kakaoMapLink(entry)).toBe(`https://map.kakao.com/link/map/${encodeURIComponent('가나다미술관')},37.5704,126.9704`);
  });

  it('좌표가 없으면 이름 검색', () => {
    expect(kakaoMapLink(entryOf({ placeName: 'CN갤러리' }))).toBe(
      `https://map.kakao.com/link/search/${encodeURIComponent('CN갤러리')}`,
    );
    expect(kakaoMapLink(entryOf({ placeName: 'CN갤러리', lat: 0, lng: 0 }))).toBe(
      `https://map.kakao.com/link/search/${encodeURIComponent('CN갤러리')}`,
    );
  });

  it('전시 좌표가 0이면 연결된 시설 좌표로 핀을 꽂는다', () => {
    const entry = entryOf({ placeName: '가나다미술관 3층', lat: 0, lng: 0 }, [VENUE]);
    expect(entry.venue?.id).toBe('venue-a');
    expect(kakaoMapLink(entry)).toBe(`https://map.kakao.com/link/map/${encodeURIComponent('가나다미술관')},37.57,126.97`);
  });

  it('좌표로만 연결된 시설은 전시 장소 이름이 따로 있으면 쓰지 않는다 (100m 안의 다른 곳일 수 있음)', () => {
    const entry = entryOf({ placeName: '갤러리 엑스', lat: 37.5704, lng: 126.9704 }, [{ ...VENUE, kakaoPlaceId: '123' }]);
    expect(entry.match.by).toBe('coord');
    expect(kakaoMapLink(entry)).toBe(`https://map.kakao.com/link/map/${encodeURIComponent('갤러리 엑스')},37.5704,126.9704`);
  });

  it('좌표로만 연결됐어도 장소 이름 칸이 망가졌으면 시설을 쓴다 (실제 서울공예박물관 전시)', () => {
    const garbled = entryOf(
      { placeName: '10:00~18:00 (평일, 주말 동일) 매주 금요일 21:00까지', lat: 37.57, lng: 126.97 },
      [{ ...VENUE, kakaoPlaceId: '123' }],
    );
    const listed = entryOf({ placeName: '교육동, 기타장소  3층 어린이박물관', lat: 37.57, lng: 126.97 }, [
      { ...VENUE, kakaoPlaceId: '123' },
    ]);
    expect(garbled.match.by).toBe('coord');
    expect(kakaoMapLink(garbled)).toBe('https://place.map.kakao.com/123');
    expect(kakaoMapLink(listed)).toBe('https://place.map.kakao.com/123');
  });

  it('장소 이름이 없으면 전시 제목을 핀 이름으로 쓴다', () => {
    expect(kakaoMapLink(entryOf({ title: '빛의 정원', lat: 37.58, lng: 126.98 }))).toBe(
      `https://map.kakao.com/link/map/${encodeURIComponent('빛의 정원')},37.58,126.98`,
    );
  });
});

describe('searchPlaceLink', () => {
  it('장소 검색으로 찾은 장소 페이지를 돌려주고, 전시 좌표 반경으로 검색한다', async () => {
    const asked = fakeSdk({ 'CN갤러리': [{ id: '777', place_name: 'CN갤러리', category_group_code: 'CT1' }] });
    const entry = entryOf({ placeName: 'CN갤러리 2층', lat: 37.58, lng: 126.98 });
    await expect(searchPlaceLink(entry)).resolves.toBe('https://place.map.kakao.com/777');
    expect(asked).toEqual([{ query: 'CN갤러리', options: { x: 126.98, y: 37.58, radius: 500 } }]);
  });

  it('결과가 없으면 null을 기억해 같은 전시는 다시 검색하지 않는다', async () => {
    const asked = fakeSdk({});
    const entry = entryOf({ placeName: '없는갤러리', lat: 37.58, lng: 126.98 });
    await expect(searchPlaceLink(entry)).resolves.toBeNull();
    await expect(searchPlaceLink(entry)).resolves.toBeNull();
    expect(asked).toHaveLength(1);
  });

  it('검색 오류는 기억하지 않아 다음에 다시 검색한다', async () => {
    const asked = fakeSdk({ '오류갤러리': 'ERROR' });
    const entry = entryOf({ placeName: '오류갤러리', lat: 37.58, lng: 126.98 });
    await expect(searchPlaceLink(entry)).resolves.toBeNull();
    await expect(searchPlaceLink(entry)).resolves.toBeNull();
    expect(asked).toHaveLength(2);
  });

  it('SDK 본체가 끝내 안 오면 시간 제한 뒤 null, 다음에 다시 시도한다', async () => {
    vi.useFakeTimers();
    fakeSdk({}, { load: false });
    const entry = entryOf({ placeName: '느린갤러리', lat: 37.58, lng: 126.98 });
    const first = searchPlaceLink(entry);
    await vi.advanceTimersByTimeAsync(8000);
    await expect(first).resolves.toBeNull();
    expect(searchPlaceLink(entry)).not.toBe(first);
  });

  it('시설에 장소 ID가 있거나, 좌표가 없거나, 장소 이름이 없으면 검색하지 않는다', async () => {
    const asked = fakeSdk({ 'CN갤러리': [{ id: '777', place_name: 'CN갤러리', category_group_code: 'CT1' }] });
    const linked = entryOf({ placeName: '가나다미술관' }, [{ ...VENUE, kakaoPlaceId: '123' }]);
    const noCoord = entryOf({ placeName: 'CN갤러리' });
    const titleOnly = entryOf({ title: 'CN갤러리', lat: 37.58, lng: 126.98 });
    await expect(searchPlaceLink(linked)).resolves.toBeNull();
    await expect(searchPlaceLink(noCoord)).resolves.toBeNull();
    await expect(searchPlaceLink(titleOnly)).resolves.toBeNull();
    expect(asked).toHaveLength(0);
  });

  it('SDK가 없으면 null', async () => {
    vi.stubGlobal('window', {});
    await expect(searchPlaceLink(entryOf({ placeName: 'CN갤러리', lat: 37.58, lng: 126.98 }))).resolves.toBeNull();
  });
});
