import { describe, it, expect } from 'vitest';
import { makeExhibitionId, findDuplicateIds, readCultcode } from './exhibition-id';

const 전시 = (title: string, placeName: string, start: string) => ({ title, placeName, start });
const 상세주소 = (code: string) =>
  `https://culture.seoul.go.kr/culture/culture/cultureEvent/view.do?cultcode=${code}&menuNo=200009`;

describe('readCultcode', () => {
  it('상세 주소에서 cultcode를 꺼낸다', () => {
    expect(readCultcode(상세주소('160056'))).toBe('160056');
  });

  it('질의 문자열 순서가 바뀌어도 읽는다', () => {
    expect(readCultcode('https://culture.seoul.go.kr/x/view.do?menuNo=200009&cultcode=158731')).toBe('158731');
  });

  it('cultcode가 없으면 null을 돌려준다', () => {
    expect(readCultcode('https://www.mmca.go.kr')).toBeNull();
    expect(readCultcode('')).toBeNull();
    expect(readCultcode(null)).toBeNull();
  });
});

describe('makeExhibitionId — cultcode', () => {
  it('cultcode가 있으면 그것을 id로 쓴다', () => {
    expect(makeExhibitionId({ ...전시('언폴드엑스 2026', 'DDP', '2026-10-01'), detailUrl: 상세주소('160056') }))
      .toBe('auto-seoul-160056');
  });

  it('제목·장소·시작일이 바뀌어도 cultcode가 같으면 같은 id다', () => {
    const before = { ...전시('언폴드엑스 2026', 'DDP', '2026-10-01'), detailUrl: 상세주소('160056') };
    const after = { ...전시('언폴드엑스 2026 [수정]', 'DDP 디자인랩', '2026-10-02'), detailUrl: 상세주소('160056') };
    expect(makeExhibitionId(after)).toBe(makeExhibitionId(before));
  });

  it('cultcode가 다르면 내용이 같아도 다른 id다', () => {
    const a = { ...전시('같은 제목', '같은 장소', '2026-10-01'), detailUrl: 상세주소('111111') };
    const b = { ...전시('같은 제목', '같은 장소', '2026-10-01'), detailUrl: 상세주소('222222') };
    expect(makeExhibitionId(a)).not.toBe(makeExhibitionId(b));
  });

  it('cultcode가 없으면 해시로 넘어간다', () => {
    const 해시 = makeExhibitionId(전시('언폴드엑스 2026', 'DDP', '2026-10-01'));
    expect(해시).toMatch(/^auto-seoul-[0-9a-f]{12}$/);
    expect(makeExhibitionId({ ...전시('언폴드엑스 2026', 'DDP', '2026-10-01'), detailUrl: 'https://www.mmca.go.kr' }))
      .toBe(해시);
  });
});

describe('makeExhibitionId — 해시로 넘어간 경우', () =>{
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
