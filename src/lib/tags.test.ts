import { describe, expect, it } from 'vitest';
import type { Exhibition, Venue } from '../types';
import type { CatalogEntry } from './catalog';
import { sharedTags, stripLeadingBrackets, TAG_KEYWORDS, TAGS, tagsOf, tagsOfText, tagText, VENUE_TAGS } from './tags';

function venue(id: string, name: string): Venue {
  return { id, name, aliases: [], gu: '종로구', type: '박물관', lat: 37.57, lng: 126.98, representative: true, source: 'test', verified: '2026-11-01' };
}

function entry(title: string, placeName?: string, v: Venue | null = null): Pick<CatalogEntry, 'exhibition' | 'venue'> {
  const exhibition: Exhibition = { id: 'x', venueId: '', title, start: '2026-11-01', end: '2026-12-31', placeName };
  return { exhibition, venue: v };
}

describe('TAG_KEYWORDS', () => {
  it('태그 7개 모두 키워드가 있다', () => {
    expect(TAGS).toHaveLength(7);
    for (const tag of TAGS) expect(TAG_KEYWORDS[tag].length).toBeGreaterThan(0);
  });
});

describe('tagsOfText — 키워드별 태그', () => {
  it.each([
    ['수묵 풍경', '회화·수묵'],
    ['조선 왕실의 유물', '역사·유적'],
    ['옻칠 이야기', '공예'],
    ['동시대 작가 단체전', '현대미술'],
    ['캐릭터 일러스트 페어', '디자인·캐릭터'],
    ['사진으로 본 도시', '사진·미디어'],
    ['국악 한마당', '민속·소리'],
    ['동양화에 기운', '회화·수묵'],
    ['기미르 세밀화', '회화·수묵'],
    ['아트노마드 아트페어', '현대미술'],
    ['DDP 건축투어', '디자인·캐릭터'],
  ])('%s → %s', (text, tag) => {
    expect(tagsOfText(text)).toContain(tag);
  });
});

describe('tagsOf', () => {
  it('제목·장소 이름·시설 이름을 합쳐서 본다', () => {
    const v = venue('venue-craft', '서울공예박물관');
    expect(tagText(entry('실루엣', '10:00~18:00', v))).toBe('실루엣 10:00~18:00 서울공예박물관');
    expect(tagsOf(entry('실루엣', '10:00~18:00', v))).toEqual(['공예']);
    expect(tagsOf(entry('다시, 아리랑', '기획전시실(별채)'))).toEqual(['민속·소리']);
    expect(tagsOf(entry('조각들', '인사도시유적전시관'))).toEqual(['역사·유적']);
  });

  it('여러 태그는 TAGS 순서로 나온다', () => {
    expect(tagsOf(entry('[서울공예박물관] 공예협력전시 [안동별궁, 시간의 겹]'))).toEqual(['역사·유적', '공예']);
    expect(tagsOf(entry('민화와 미디어아트', '국립현대미술관'))).toEqual(['회화·수묵', '현대미술', '사진·미디어']);
  });

  it('태그가 없으면 빈 배열', () => {
    expect(tagsOf(entry('[서울갤러리] 런치 스테이지 [싱어송라이터 이훈주]', '서울갤러리 지하 1층 공연장'))).toEqual([]);
    expect(tagsOf(entry(''))).toEqual([]);
  });
});

describe('한 글자·짧은 키워드 오탐 방지', () => {
  it('궁: 운현궁·별궁·"궁 ;"은 걸리고 궁금·궁극·궁리·자궁은 안 걸린다', () => {
    expect(tagsOfText('[운현궁] 하우스뮤지엄')).toEqual(['역사·유적']);
    expect(tagsOfText('[궁 ; Re-숨]')).toEqual(['역사·유적']);
    expect(tagsOfText('경복궁에서')).toEqual(['역사·유적']);
    expect(tagsOfText('궁금한 이야기')).toEqual([]);
    expect(tagsOfText('궁극의 맛')).toEqual([]);
    expect(tagsOfText('궁리하는 손')).toEqual([]);
    expect(tagsOfText('자궁')).toEqual([]);
  });

  it('빛: "물드는 빛"은 걸리고 "빛나는"은 안 걸린다', () => {
    expect(tagsOfText('[물드는 빛]')).toEqual(['사진·미디어']);
    expect(tagsOfText('빛나는 순간')).toEqual([]);
  });

  it('도자 ≠ 지도자, 화가 ≠ 문화가, 그림 ≠ 그림자, 산수 ≠ 산수유, 독립 ≠ 독립영화', () => {
    expect(tagsOfText('청년 지도자 포럼')).toEqual([]);
    expect(tagsOfText('도자기 특별전')).toEqual(['공예']);
    expect(tagsOfText('문화가 있는 날')).toEqual([]);
    expect(tagsOfText('여성 화가의 초상')).toEqual(['회화·수묵']);
    expect(tagsOfText('그림자 극장')).toEqual([]);
    expect(tagsOfText('산수유 축제')).toEqual([]);
    expect(tagsOfText('독립영화 상영회')).toEqual([]);
    expect(tagsOfText('독립운동가의 편지')).toEqual(['역사·유적']);
  });

  it('현대미술은 "현대"만으로 걸리지 않는다(현대카드·현대공예)', () => {
    expect(tagsOfText('현대카드 컬처프로젝트')).toEqual([]);
    expect(tagsOfText('현대공예 기증특별전')).toEqual(['공예']);
  });
});

describe('제목 앞 기관 표기 무시', () => {
  it('맨 앞 대괄호 표기를 모두 빼고, 가운데·뒤 대괄호는 남긴다', () => {
    expect(stripLeadingBrackets('[서울역사박물관] 태화관')).toBe('태화관');
    expect(stripLeadingBrackets(' [A] [B]  제목 [부제]')).toBe('제목 [부제]');
    expect(stripLeadingBrackets('제목 [부제]')).toBe('제목 [부제]');
    expect(stripLeadingBrackets('[운현궁] 2026 기획전시 [궁 ; Re-숨]')).toBe('2026 기획전시 [궁 ; Re-숨]');
  });

  it('웨인 티보: 장소에 디자인 표시가 없으면 [서울디자인재단]만으로는 디자인 태그가 없다', () => {
    expect(tagsOf(entry('[서울디자인재단] 현대카드 컬처프로젝트 31 웨인 티보 전 [The Order of Things]', '뮤지엄 전시 1관'))).toEqual([]);
    // 실제 auto.json 장소는 "DDP 뮤지엄 전시 1관"이라 DDP 키워드로 디자인이 남는다(DDP 장소 규칙)
    expect(tagsOf(entry('[서울디자인재단] 현대카드 컬처프로젝트 31 웨인 티보 전 [The Order of Things]', 'DDP 뮤지엄 전시 1관'))).toEqual(['디자인·캐릭터']);
  });

  it('DDP·동대문디자인플라자 장소 전시는 디자인 태그를 유지한다', () => {
    expect(tagsOf(entry('[DDP] Dream in Light', 'DDP 전면, 유구전시장 앞'))).toEqual(['디자인·캐릭터']);
    expect(tagsOf(entry('[서울시립과학관] 특별전 [가장 긴, 시작]', '동대문디자인플라자(DDP) 뮤지엄 3층'))).toEqual(['디자인·캐릭터']);
  });

  it('기관 표기에만 있던 키워드는 빠지고, 장소 이름에 있으면 남는다', () => {
    expect(tagsOf(entry('[서울역사박물관] 유럽영화제', '야주개홀'))).toEqual([]);
    expect(tagsOf(entry('[서울역사박물관] 유럽영화제', '서울역사박물관 야주개홀'))).toEqual(['역사·유적']);
    expect(tagsOf(entry('[운현궁] 하우스뮤지엄 홍준희 개인전', '운현궁 노락당'))).toEqual(['역사·유적', '현대미술']);
  });

  it('tagText에도 기관 표기가 빠진다', () => {
    expect(tagText(entry('[서울공예박물관] 실루엣', '서울공예박물관'))).toBe('실루엣 서울공예박물관');
  });
});

describe('대표 시설 기본 태그', () => {
  it('venue-sema 전시는 키워드가 없어도 현대미술', () => {
    expect(tagsOf(entry('요모조모 이슬기', '서울시립미술관 서소문본관 1층', venue('venue-sema', '서울시립미술관(SeMA)')))).toEqual(['현대미술']);
  });

  it('키워드 태그와 합쳐지고 중복 없이 TAGS 순서', () => {
    // 키워드: 사진·미디어 + 시설: 현대미술
    expect(tagsOf(entry('미디어 아트', '세마홀', venue('venue-sema', '서울시립미술관(SeMA)')))).toEqual(['현대미술', '사진·미디어']);
    // 키워드도 공예, 시설도 공예 → 한 번만
    expect(tagsOf(entry('[서울공예박물관] 현대공예 기증특별전', '기획전시실', venue('venue-craft-museum', '서울공예박물관')))).toEqual(['공예']);
    // 시설 역사·유적 + 키워드 공예
    expect(tagsOf(entry('유리 공예', '야주개홀', venue('venue-seoul-history-museum', '서울역사박물관')))).toEqual(['역사·유적', '공예']);
  });

  it('기본 태그가 없는 시설(국립현대미술관 등)은 키워드 태그만', () => {
    expect(VENUE_TAGS['venue-mmca']).toBeUndefined();
    expect(tagsOf(entry('사진전', '서울관', venue('venue-mmca', '가나관')))).toEqual(['사진·미디어']);
    expect(tagsOf(entry('무제', '서울관', venue('venue-other', '가나관')))).toEqual([]);
  });

  it('표의 시설 id 9개와 태그', () => {
    expect(VENUE_TAGS).toEqual({
      'venue-sema': ['현대미술'],
      'venue-sema-archive': ['현대미술'],
      'venue-craft-museum': ['공예'],
      'venue-seoul-uri-sori-museum': ['민속·소리'],
      'venue-park-no-soo-museum': ['회화·수묵'],
      'venue-korean-art-museum': ['회화·수묵'],
      'venue-seoul-history-museum': ['역사·유적'],
      'venue-gongpyeong-site-museum': ['역사·유적'],
      'venue-insa-site-museum': ['역사·유적'],
    });
  });

  it('"아카이브"만 있는 제목은 역사 태그가 없다(미술아카이브는 시설 태그로 현대미술)', () => {
    expect(tagsOfText('서울시립 미술아카이브 소장자료 기획전 [오윤]')).toEqual([]);
    expect(tagsOf(entry('[서울시립 미술아카이브] 소장자료 기획전 [오윤]', '서울시립 미술아카이브 모음동', venue('venue-sema-archive', '서울시립 미술아카이브')))).toEqual(['현대미술']);
  });
});

describe('sharedTags', () => {
  it('겹치는 태그만 TAGS 순서로', () => {
    expect(sharedTags(['공예', '회화·수묵', '민속·소리'], ['민속·소리', '회화·수묵'])).toEqual(['회화·수묵', '민속·소리']);
    expect(sharedTags(['공예'], [])).toEqual([]);
  });
});
