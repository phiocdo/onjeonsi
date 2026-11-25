import { describe, expect, it } from 'vitest';
import { isExhibitionCode, isTargetEvent, isTargetGu } from './exhibition-filter';

describe('isTargetGu', () => {
  it.each(['종로구', '중구', ' 중구 '])('%s는 수집한다', (gu) => {
    expect(isTargetGu(gu)).toBe(true);
  });

  it.each(['중랑구', '강남구', '', undefined])('%s는 수집하지 않는다', (gu) => {
    expect(isTargetGu(gu)).toBe(false);
  });
});

describe('isExhibitionCode', () => {
  it('전시/미술만 전시로 본다', () => {
    expect(isExhibitionCode('전시/미술')).toBe(true);
    expect(isExhibitionCode(' 전시/미술 ')).toBe(true);
  });

  // 2026-11-25 API에 있는 분류 값 중 전시/미술을 뺀 전부
  it.each([
    '교육/체험', '콘서트', '영화', '국악', '클래식', '무용', '연극', '뮤지컬/오페라', '독주/독창회', '기타',
    '축제-기타', '축제-문화/예술', '축제-전통/역사', '축제-시민화합', '축제-자연/경관', '축제-관광/체육', '', undefined,
  ])('%s는 전시가 아니다', (code) => {
    expect(isExhibitionCode(code)).toBe(false);
  });
});

describe('isTargetEvent', () => {
  it('종로구·중구의 전시만 고른다', () => {
    expect(isTargetEvent({ GUNAME: '종로구', CODENAME: '전시/미술' })).toBe(true);
    expect(isTargetEvent({ GUNAME: '강남구', CODENAME: '전시/미술' })).toBe(false);
  });

  it('미술관·박물관·갤러리·DDP에서 열려도 전시 분류가 아니면 고르지 않는다', () => {
    // 2026-11-25 실제로 장소 조건 때문에 들어오던 행사들. 장소 칸은 보지 않는다
    expect(isTargetEvent({ GUNAME: '중구', CODENAME: '콘서트' })).toBe(false); // [서울갤러리] 런치 스테이지
    expect(isTargetEvent({ GUNAME: '종로구', CODENAME: '영화' })).toBe(false); // [서울역사박물관] 유럽영화제
    expect(isTargetEvent({ GUNAME: '중구', CODENAME: '교육/체험' })).toBe(false); // DDP 건축투어
  });
});
