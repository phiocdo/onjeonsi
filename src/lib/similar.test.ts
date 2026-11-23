import { describe, expect, it } from 'vitest';
import type { Exhibition, Venue } from '../types';
import type { CatalogEntry } from './catalog';
import { isExhibitionLike, NON_EXHIBITION_FIELDS, similarExhibitions } from './similar';

const TODAY = '2026-11-22';

function venue(id: string, name: string, lat: number, lng: number): Venue {
  return { id, name, aliases: [], gu: '종로구', type: '미술관', lat, lng, representative: true, source: 'test', verified: '2026-11-01' };
}

// 태그 키워드가 없는 시설 이름을 쓴다(시설 이름이 태그에 끼어들지 않게)
const V_A = venue('venue-a', '가나다관', 37.57, 126.98);
const V_NEAR = venue('venue-near', '라마바관', 37.571, 126.98); // V_A에서 약 110m
const V_FAR = venue('venue-far', '사아자관', 37.6, 126.98); // V_A에서 약 3.3km

type Opt = { start?: string; end?: string; venue?: Venue | null; lat?: number; lng?: number; field?: string };

function make(id: string, title: string, o: Opt = {}): CatalogEntry {
  const exhibition: Exhibition = {
    id,
    venueId: '',
    title,
    start: o.start ?? '2026-11-01',
    end: o.end ?? '2026-12-31',
    field: o.field,
    lat: o.lat,
    lng: o.lng,
  };
  const v = o.venue === undefined ? null : o.venue;
  return {
    exhibition,
    venue: v,
    match: { venueId: v?.id ?? null, by: v ? 'alias' : null },
    resolved: {} as CatalogEntry['resolved'],
  };
}

const ids = (list: CatalogEntry[]) => list.map((e) => e.exhibition.id);

describe('similarExhibitions', () => {
  it('자기 자신은 빠진다', () => {
    const t = make('t', '수묵 산수');
    const twin = make('t', '수묵 산수 (같은 id)');
    const other = make('o', '수묵 풍경');
    expect(ids(similarExhibitions(t, [t, twin, other], { today: TODAY }))).toEqual(['o']);
  });

  it('끝난 전시와 기간 정보가 없는 전시는 빠지고, 오늘 끝나는 전시는 남는다', () => {
    const t = make('t', '공예 특별전');
    const ended = make('ended', '공예 작은전', { end: '2026-11-21' });
    const todayEnd = make('today', '공예 큰전', { end: TODAY });
    const noEnd = make('noend', '공예 무기한', { end: '' });
    const noStart = make('nostart', '공예 시작모름', { start: '' });
    expect(ids(similarExhibitions(t, [t, ended, todayEnd, noEnd, noStart], { today: TODAY }))).toEqual(['today']);
  });

  it('아직 시작하지 않은 전시와 시작일이 날짜가 아닌 전시는 빠지고, 오늘 시작하는 전시는 남는다', () => {
    const t = make('t', '공예 특별전');
    const future = make('future', '공예 예정', { start: '2026-11-23' });
    const todayStart = make('todaystart', '공예 개막', { start: TODAY });
    const badStart = make('bad', '공예 미정', { start: '상시' });
    expect(ids(similarExhibitions(t, [t, future, todayStart, badStart], { today: TODAY }))).toEqual(['todaystart']);
  });

  it('비전시 행사(field)는 후보에서 빠진다', () => {
    const t = make('t', '공예 특별전', { field: '전시/미술' });
    const show = make('show', '공예 전시', { field: '전시/미술' });
    const noField = make('nofield', '공예 상설');
    const edu = make('edu', '공예 체험', { field: '교육/체험' });
    const concert = make('concert', '공예 음악회', { field: '콘서트' });
    const fest = make('fest', '공예 축제', { field: '축제-기타' });
    expect(ids(similarExhibitions(t, [t, show, noField, edu, concert, fest], { today: TODAY }))).toEqual(['nofield', 'show']); // 종료일 같음 → 제목 순
  });

  it('target이 비전시 행사면 빈 배열(상세 창의 칸을 숨긴다)', () => {
    const v = { venue: V_A };
    const film = make('film', '공예 영화', { field: '영화', ...v });
    const show = make('show', '공예 전시', { field: '전시/미술', ...v });
    expect(similarExhibitions(film, [film, show], { today: TODAY })).toEqual([]);
    // 태그 없는 비전시 행사도 같은 시설 대체를 하지 않는다
    const lunch = make('lunch', '런치 스테이지', { field: '콘서트', ...v });
    expect(similarExhibitions(lunch, [lunch, show], { today: TODAY })).toEqual([]);
  });

  it('isExhibitionLike: auto.json의 비전시 field 값을 모두 가린다', () => {
    for (const f of ['교육/체험', '콘서트', '영화', '국악', '축제-기타']) {
      expect(NON_EXHIBITION_FIELDS.has(f)).toBe(true);
      expect(isExhibitionLike(make('x', '제목', { field: f }))).toBe(false);
    }
    expect(isExhibitionLike(make('x', '제목', { field: '전시/미술' }))).toBe(true);
    expect(isExhibitionLike(make('x', '제목'))).toBe(true);
  });

  it('겹치는 태그가 많은 순, 겹침 0은 후보가 아니다', () => {
    const t = make('t', '조선 왕실 공예와 수묵'); // 회화·수묵, 역사·유적, 공예
    const one = make('one', '수묵 소품');
    const two = make('two', '조선 공예');
    const three = make('three', '고려 도자와 서예');
    const none = make('none', '런치 스테이지');
    const other = make('other', '사진 여행'); // 사진·미디어만
    expect(ids(similarExhibitions(t, [t, one, two, three, none, other], { today: TODAY }))).toEqual(['three', 'two', 'one']);
  });

  it('같은 점수면 같은 시설이 먼저', () => {
    const t = make('t', '공예전', { venue: V_A });
    const near = make('near', '공예 가까운', { venue: V_NEAR, end: '2026-11-25' });
    const same = make('same', '공예 같은관', { venue: V_A, end: '2027-06-30' });
    expect(ids(similarExhibitions(t, [near, same], { today: TODAY }))).toEqual(['same', 'near']);
  });

  it('그다음 가까운 순, 좌표 없는 전시는 뒤로', () => {
    const t = make('t', '공예전', { venue: V_A });
    const far = make('far', '공예 먼', { venue: V_FAR, end: '2026-11-23' });
    const near = make('near', '공예 가까운', { venue: V_NEAR, end: '2027-01-31' });
    const exCoord = make('excoord', '공예 전시좌표', { lat: 37.58, lng: 126.98 }); // 시설 없음, 전시 좌표 약 1.1km
    const nowhere = make('nowhere', '공예 좌표없음', { end: '2026-11-22' });
    const zero = make('zero', '공예 영좌표', { lat: 0, lng: 0 });
    expect(ids(similarExhibitions(t, [nowhere, zero, far, exCoord, near], { today: TODAY, limit: 10 }))).toEqual([
      'near',
      'excoord',
      'far',
      'nowhere', // 좌표 없음 → 종료일 이른 순
      'zero',
    ]);
  });

  it('target에 좌표가 없으면 거리는 건너뛰고 종료일 → 제목 순', () => {
    const t = make('t', '공예전');
    const b = make('b', '공예 나', { venue: V_FAR, end: '2026-12-31' });
    const a = make('a', '공예 가', { venue: V_NEAR, end: '2026-12-31' });
    const early = make('early', '공예 하', { venue: V_FAR, end: '2026-12-01' });
    expect(ids(similarExhibitions(t, [b, a, early], { today: TODAY }))).toEqual(['early', 'a', 'b']);
  });

  it('target에 태그가 없으면 같은 시설 전시를 대신 쓴다', () => {
    const t = make('t', '요모조모', { venue: V_A });
    const same1 = make('s1', '나의 나들', { venue: V_A, end: '2027-02-21' });
    const same2 = make('s2', '기술의 저변', { venue: V_A, end: TODAY });
    const tagged = make('tagged', '공예전', { venue: V_NEAR });
    const sameEnded = make('ended', '지난 전시', { venue: V_A, end: '2026-11-01' });
    expect(ids(similarExhibitions(t, [t, same1, same2, tagged, sameEnded], { today: TODAY }))).toEqual(['s2', 's1']);
  });

  it('후보가 없으면 빈 배열', () => {
    const t = make('t', '공예전', { venue: V_A });
    expect(similarExhibitions(t, [t, make('o', '사진전')], { today: TODAY })).toEqual([]);
    // 태그도 시설도 없으면 빈 배열
    const lonely = make('lonely', '런치 스테이지');
    expect(similarExhibitions(lonely, [lonely, make('o', '런치 콘서트')], { today: TODAY })).toEqual([]);
    expect(similarExhibitions(t, [], { today: TODAY })).toEqual([]);
  });

  it('limit 기본 4, 지정하면 그만큼, 0이면 빈 배열', () => {
    const t = make('t', '공예전');
    const many = Array.from({ length: 6 }, (_, i) => make(`m${i}`, `공예 ${i}`, { end: `2026-12-0${i + 1}` }));
    expect(ids(similarExhibitions(t, many, { today: TODAY }))).toEqual(['m0', 'm1', 'm2', 'm3']);
    expect(ids(similarExhibitions(t, many, { today: TODAY, limit: 2 }))).toEqual(['m0', 'm1']);
    expect(similarExhibitions(t, many, { today: TODAY, limit: 0 })).toEqual([]);
  });

  it('입력 배열을 바꾸지 않고, 순서를 바꿔 넣어도 결과가 같다', () => {
    const t = make('t', '공예전', { venue: V_A });
    const list = [make('c', '공예 다'), make('a', '공예 가'), make('b', '공예 나', { venue: V_NEAR })];
    const copy = [...list];
    const r1 = ids(similarExhibitions(t, list, { today: TODAY }));
    const r2 = ids(similarExhibitions(t, [...list].reverse(), { today: TODAY }));
    expect(list).toEqual(copy);
    expect(r1).toEqual(r2);
    expect(r1).toEqual(['b', 'a', 'c']);
  });
});
