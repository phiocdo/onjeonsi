import { describe, expect, it } from 'vitest';
import {
  findPlace,
  kakaoMapUrl,
  kakaoPlaceUrl,
  normalizeKakaoName,
  pickPlace,
  placeSearchQueries,
  type KakaoPlace,
} from './kakaoPlace';

const place = (id: string, name: string, category = 'CT1'): KakaoPlace => ({
  id,
  place_name: name,
  category_group_code: category,
});

describe('kakaoPlaceUrl / kakaoMapUrl', () => {
  it('장소 페이지 주소', () => {
    expect(kakaoPlaceUrl('17952661')).toBe('https://place.map.kakao.com/17952661');
  });

  it('좌표가 있으면 핀 지도, 없으면 이름 검색 (기존 링크와 같은 모양)', () => {
    expect(kakaoMapUrl('국립현대미술관 서울', { lat: 37.5788, lng: 126.9802 })).toBe(
      'https://map.kakao.com/link/map/%EA%B5%AD%EB%A6%BD%ED%98%84%EB%8C%80%EB%AF%B8%EC%88%A0%EA%B4%80%20%EC%84%9C%EC%9A%B8,37.5788,126.9802',
    );
    expect(kakaoMapUrl('CN갤러리', null)).toBe('https://map.kakao.com/link/search/CN%EA%B0%A4%EB%9F%AC%EB%A6%AC');
  });

  it('핀 지도 이름의 쉼표는 공백으로 바꾼다 (이름,위도,경도 칸이 쪼개지지 않게)', () => {
    expect(kakaoMapUrl('DDP 전면, 유구전시장 앞', { lat: 37.5673, lng: 127.0097 })).toBe(
      `https://map.kakao.com/link/map/${encodeURIComponent('DDP 전면 유구전시장 앞')},37.5673,127.0097`,
    );
  });
});

describe('normalizeKakaoName', () => {
  it('글자·숫자만 남기고 소문자로', () => {
    expect(normalizeKakaoName('서울시립미술관(SeMA)')).toBe('서울시립미술관sema');
    expect(normalizeKakaoName(' 국립현대미술관 · 서울 ')).toBe('국립현대미술관서울');
  });
});

describe('placeSearchQueries', () => {
  it('층·전시실부터 뒤는 버리고 앞에서부터 줄여 간다', () => {
    expect(placeSearchQueries('서울시립미술관 서소문본관 1층 전시실')).toEqual(['서울시립미술관 서소문본관', '서울시립미술관']);
    expect(placeSearchQueries('서울공예박물관 전시1동 3층 기획전시실')).toEqual(['서울공예박물관']);
    expect(placeSearchQueries('갤러리제이원 서울 1,2F')).toEqual(['갤러리제이원 서울', '갤러리제이원']);
    expect(placeSearchQueries('서울시청 지하1층 내친구서울관 1/2관 사이 로비')).toEqual(['서울시청']);
  });

  it('전시실·로비로 끝나는 낱말부터 뒤는 버린다', () => {
    expect(placeSearchQueries('운현궁 기획전시실')).toEqual(['운현궁']);
    expect(placeSearchQueries('서울우리소리박물관 기획전시실(별채)')).toEqual(['서울우리소리박물관']);
  });

  it('첫 낱말은 숫자가 있어도 둔다', () => {
    expect(placeSearchQueries('문화역서울284')).toEqual(['문화역서울284']);
  });

  it('괄호 안은 지운다', () => {
    expect(placeSearchQueries('동대문디자인플라자(DDP) 쇼룸 1층 (서울 중구 을지로 281)')).toEqual([
      '동대문디자인플라자 쇼룸',
      '동대문디자인플라자',
    ]);
    expect(placeSearchQueries('서울시립미술관(SeMA)')).toEqual(['서울시립미술관']);
    expect(placeSearchQueries('동대문디자인플라자（DDP） 쇼룸')).toEqual(['동대문디자인플라자 쇼룸', '동대문디자인플라자']);
  });

  it('괄호 안에만 운영시간이 있으면 검색한다', () => {
    expect(placeSearchQueries('국립현대미술관 서울 (10:00~18:00)')).toEqual(['국립현대미술관 서울', '국립현대미술관']);
  });

  it('검색어는 4개까지', () => {
    expect(placeSearchQueries('가 나 다 라 마 바')).toEqual(['가 나 다 라 마 바', '가 나 다 라 마', '가 나 다 라', '가 나 다']);
  });

  it('운영시간 문구이거나 첫 낱말부터 숫자·쉼표면 검색하지 않는다', () => {
    expect(placeSearchQueries('화-일요일 13:00~19:00')).toEqual([]);
    expect(placeSearchQueries('10:00~18:00 (평일, 주말 동일) 매주 금요일 21:00까지')).toEqual([]);
    expect(placeSearchQueries('교육동, 기타장소  3층 어린이박물관')).toEqual([]);
    expect(placeSearchQueries('  ')).toEqual([]);
  });
});

describe('pickPlace', () => {
  it('이름이 같은 장소를 먼저 고른다', () => {
    const results = [place('1', '서울공예박물관 카페'), place('2', '서울공예박물관')];
    expect(pickPlace(results, '서울공예박물관 전시1동 3층 기획전시실')?.id).toBe('2');
  });

  it('결과 이름이 우리 이름에 들어 있으면 고른다 (긴 것 먼저)', () => {
    const results = [place('1', '국립현대미술관'), place('2', '국립현대미술관 서울')];
    expect(pickPlace(results, '국립현대미술관 서울관')?.id).toBe('2');
    expect(pickPlace([place('3', '박노수미술관')], '종로구립 박노수미술관')?.id).toBe('3');
  });

  it('우리 이름이 결과 이름에 들어 있으면 고른다 (짧은 것 먼저)', () => {
    const results = [place('1', '서울시립미술관 서소문본관 야외조각'), place('2', '서울시립미술관 서소문본관')];
    expect(pickPlace(results, '서울시립미술관(SeMA)')?.id).toBe('2');
  });

  it('주차장·카페 같은 부속 장소는 이름이 맞아도 고르지 않는다', () => {
    const results = [place('1', '국립현대미술관 서울 주차장', 'PK6'), place('2', '국립현대미술관 서울 카페', 'CE7')];
    expect(pickPlace(results, '국립현대미술관 서울')).toBeNull();
  });

  it('분류 코드가 없는 부속 장소(도서관·단체)도 고르지 않는다 — 실제 "서울시립미술관" 검색 결과', () => {
    const results = [
      place('10507051', '서울시립미술관 서소문본관', 'CT1'),
      place('816176632', '서울시립미술관 주차장', 'PK6'),
      place('27217388', '서울시립미술관 자료실', ''),
      place('1894203516', '서울시립미술관후원회 세마인', ''),
    ];
    expect(pickPlace(results, '서울시립미술관(SeMA)')?.id).toBe('10507051');
  });

  it('숙박·학원 같은 분류는 이름이 맞아도 고르지 않는다', () => {
    expect(pickPlace([place('1', '와이아트', 'AC5')], '와이아트 갤러리')).toBeNull();
    expect(pickPlace([place('2', '지우헌', 'AD5')], '갤러리 지우헌')).toBeNull();
    expect(pickPlace([place('3', '청와대 사랑채', 'HP8')], '청와대 사랑채')).toBeNull();
  });

  it('관광명소(AT4)는 고른다', () => {
    expect(pickPlace([place('5', '운현궁', 'AT4')], '운현궁 노락당')?.id).toBe('5');
  });

  it('낱말 순서만 다르면 같은 이름이다', () => {
    expect(pickPlace([place('2059910789', '딜라이트 갤러리', '')], '갤러리 딜라이트 1층')?.id).toBe('2059910789');
  });

  it('이름이 같거나 더 넓은 장소면 분류 코드가 없어도 고른다 — 실제 DDP·남산골한옥마을 검색 결과', () => {
    expect(pickPlace([place('25022134', '동대문디자인플라자', '')], '동대문디자인플라자(DDP) 쇼룸 1층')?.id).toBe('25022134');
    expect(pickPlace([place('8246127', '남산골한옥마을', '')], '남산골한옥마을')?.id).toBe('8246127');
  });

  it('우리 이름 뒤에 뭔가 붙은 결과는 분류 코드가 없으면 고르지 않는다 — 실제 "DDP" 검색 결과', () => {
    const results = [place('1967860302', 'DDP패션몰', ''), place('812717253', '동대문DDP주차장', 'PK6')];
    expect(pickPlace(results, 'DDP 전면, 유구전시장 앞, 미래로 상부')).toBeNull();
  });

  it('짧은 검색어로 찾았어도 전체 이름과 맞아야 한다 (근처의 아무 갤러리나 고르지 않는다)', () => {
    const results = [place('1', '갤러리현대'), place('2', '갤러리')];
    expect(pickPlace(results, '갤러리 딜라이트 1층')).toBeNull();
  });

  it('이름이 너무 짧은 결과와는 포함 관계로 맞추지 않는다', () => {
    expect(pickPlace([place('1', '서울')], '서울시청')).toBeNull();
  });

  it('짧은 쪽이 긴 쪽의 절반이 안 되면 포함 관계로 맞추지 않는다', () => {
    expect(pickPlace([place('1', '세종문화회관')], '세종문화회관 외벽 미디어파사드')).toBeNull();
    expect(pickPlace([place('2', '운현궁')], '운현궁 노락당')?.id).toBe('2');
    expect(pickPlace([place('3', '서울시립미술관 서소문본관 야외조각공원')], '서울시립미술관')).toBeNull();
  });

  it('우리 이름이 "갤러리" 같은 일반 이름뿐이면 고르지 않는다', () => {
    expect(pickPlace([place('1', '갤러리현대')], '갤러리 1층')).toBeNull();
    expect(pickPlace([place('2', '서울미술관')], '미술관')).toBeNull();
  });

  it('검색어를 만들 수 없는 이름이면 null', () => {
    expect(pickPlace([place('1', '화-일요일')], '화-일요일 13:00~19:00')).toBeNull();
  });
});

describe('findPlace', () => {
  const pos = { lat: 37.57, lng: 126.98 };

  it('긴 검색어부터 던지고 처음 맞는 장소에서 멈춘다', async () => {
    const asked: string[] = [];
    const search = async (query: string) => {
      asked.push(query);
      return query === '동대문디자인플라자' ? [place('9', '동대문디자인플라자')] : [];
    };
    const found = await findPlace('동대문디자인플라자(DDP) 쇼룸 1층', pos, search);
    expect(found?.id).toBe('9');
    expect(asked).toEqual(['동대문디자인플라자 쇼룸', '동대문디자인플라자']);
  });

  it('맞는 장소가 없으면 null', async () => {
    const found = await findPlace('갤러리 딜라이트 1층', pos, async () => [place('1', '갤러리현대')]);
    expect(found).toBeNull();
  });

  it('검색 좌표를 그대로 넘긴다', async () => {
    let at: unknown = null;
    await findPlace('한국미술관', pos, async (_query, p) => {
      at = p;
      return [];
    });
    expect(at).toEqual(pos);
  });
});
