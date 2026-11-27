import { describe, expect, it } from 'vitest';
import { describePlace, insertKakaoPlaceId } from './kakao-place.ts';

const VENUE = `{
  "id": "venue-a",
  "lat": 37.57,
  "lng": 126.97,
  "representative": true,
  "hours": {
    "mon": { "open": "10:00", "close": "18:00" }
  }
}
`;

describe('insertKakaoPlaceId', () => {
  const textOf = (result: ReturnType<typeof insertKakaoPlaceId>) => (result.ok ? result.text : null);

  it('"lng" 다음 줄에 넣고 나머지 글자는 그대로 둔다', () => {
    const next = textOf(insertKakaoPlaceId(VENUE, '123'));
    expect(next).toBe(VENUE.replace('"lng": 126.97,\n', '"lng": 126.97,\n  "kakaoPlaceId": "123",\n'));
    expect(JSON.parse(next!).kakaoPlaceId).toBe('123');
  });

  it('CRLF 줄바꿈을 지킨다', () => {
    const crlf = VENUE.replace(/\n/g, '\r\n');
    expect(textOf(insertKakaoPlaceId(crlf, '123'))).toContain('"lng": 126.97,\r\n  "kakaoPlaceId": "123",\r\n');
  });

  it('"lng" 줄 쉼표 뒤에 공백이 있어도 넣는다', () => {
    const next = textOf(insertKakaoPlaceId(VENUE.replace('"lng": 126.97,', '"lng": 126.97,  '), '123'));
    expect(JSON.parse(next!).kakaoPlaceId).toBe('123');
  });

  it('넣지 못하면 이유를 나눠 돌려준다', () => {
    expect(insertKakaoPlaceId(textOf(insertKakaoPlaceId(VENUE, '123'))!, '456')).toEqual({ ok: false, reason: 'exists' });
    expect(insertKakaoPlaceId(VENUE.replace('"lng": 126.97,', '"lng": 126.97, "kakaoPlaceId": "",'), '456')).toEqual({
      ok: false,
      reason: 'exists',
    });
    expect(insertKakaoPlaceId('{ "id": "venue-a" }', '123')).toEqual({ ok: false, reason: 'no-lng' });
  });
});

describe('describePlace', () => {
  it('ID·이름·마지막 분류·도로명 주소·거리', () => {
    expect(
      describePlace({
        id: '17952661',
        place_name: '국립현대미술관 서울',
        category_name: '문화,예술 > 문화시설 > 미술관',
        address_name: '서울 종로구 소격동 165',
        road_address_name: '서울 종로구 삼청로 30',
        distance: '12',
      }),
    ).toBe('17952661 국립현대미술관 서울 · 미술관 · 서울 종로구 삼청로 30 · 12m');
  });

  it('없는 칸은 건너뛴다', () => {
    expect(describePlace({ id: '1', place_name: '어딘가', address_name: '서울 중구' })).toBe('1 어딘가 · 서울 중구');
  });
});
