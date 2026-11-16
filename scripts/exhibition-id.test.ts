import { describe, it, expect } from 'vitest';
import { makeExhibitionId, findDuplicateIds } from './exhibition-id';

const 전시 = (title: string, placeName: string, start: string) => ({ title, placeName, start });

describe('makeExhibitionId', () => {
  it('같은 전시는 몇 번을 수집해도 같은 id가 나온다', () => {
    const ex = 전시('언폴드엑스 2026', 'DDP', '2026-10-01');
    expect(makeExhibitionId(ex)).toBe(makeExhibitionId({ ...ex }));
  });

  it('목록에서 몇 번째인지와 무관하다', () => {
    // 앞의 전시가 끝나서 빠져도 뒤 전시의 id는 그대로여야 한다
    const list = [
      전시('가', 'A관', '2026-01-01'),
      전시('나', 'B관', '2026-02-01'),
      전시('다', 'C관', '2026-03-01'),
    ];
    const before = list.map(makeExhibitionId);
    const after = list.slice(1).map(makeExhibitionId);
    expect(after).toEqual(before.slice(1));
  });

  it('제목이 같아도 시작일이 다르면 다른 id가 된다', () => {
    // 정기 프로그램이 같은 제목으로 반복 등록되는 경우
    const a = 전시('[서울갤러리] 런치 스테이지 [하모니시스트 이한결]', '서울갤러리 지하 1층 공연장', '2026-10-11');
    const b = 전시('[서울갤러리] 런치 스테이지 [하모니시스트 이한결]', '서울갤러리 지하 1층 공연장', '2026-11-28');
    expect(makeExhibitionId(a)).not.toBe(makeExhibitionId(b));
  });

  it('제목과 시작일이 같아도 장소가 다르면 다른 id가 된다', () => {
    const a = 전시('대대손손 공예', '서울공예박물관 전시3동 1층 사랑방', '2026-05-04');
    const b = 전시('대대손손 공예', '서울공예박물관 전시3동 1층 교육실', '2026-05-04');
    expect(makeExhibitionId(a)).not.toBe(makeExhibitionId(b));
  });

  it('주소에 쓸 수 없는 문자가 섞여도 id에는 남지 않는다', () => {
    // HashRouter 주소에서 `#`은 경로를 끊고 `&`도 예약 문자다
    const id = makeExhibitionId(전시('[서울공예박물관] 공예동행@쇼윈도 #6. 실루엣 & Silhouette', '쇼윈도', '2026-09-01'));
    expect(id).toMatch(/^auto-seoul-[0-9a-f]{12}$/);
  });

  it('장소가 비어 있어도 크래시 없이 id가 나온다', () => {
    // 서울시 API가 PLACE를 비워서 보내는 경우
    expect(makeExhibitionId({ title: '언폴드엑스 2026', placeName: null, start: '2026-10-01' }))
      .toMatch(/^auto-seoul-[0-9a-f]{12}$/);
    expect(makeExhibitionId({ title: null, placeName: undefined, start: null }))
      .toMatch(/^auto-seoul-[0-9a-f]{12}$/);
  });

  it('앞뒤 공백은 같은 전시로 본다', () => {
    const a = 전시('  언폴드엑스 2026 ', ' DDP ', '2026-10-01');
    const b = 전시('언폴드엑스 2026', 'DDP', '2026-10-01');
    expect(makeExhibitionId(a)).toBe(makeExhibitionId(b));
  });
});

describe('findDuplicateIds', () => {
  it('겹치는 id가 없으면 빈 배열을 돌려준다', () => {
    expect(findDuplicateIds([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual([]);
  });

  it('겹치는 id를 한 번씩만 돌려준다', () => {
    expect(findDuplicateIds([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'a' }])).toEqual(['a']);
  });
});
