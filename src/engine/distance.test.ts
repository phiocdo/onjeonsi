import { describe, it, expect } from 'vitest';
import { calculateDistance, sortByDistance, type Coordinate } from './distance';

const GANGNAM: Coordinate = { lat: 37.497942, lng: 127.027621 }; // 강남역
const YEOKSAM: Coordinate = { lat: 37.500622, lng: 127.036456 }; // 역삼역
const SEOUL_CITY_HALL: Coordinate = { lat: 37.566535, lng: 126.977969 };
const BUSAN_CITY_HALL: Coordinate = { lat: 35.179554, lng: 129.075642 };

describe('calculateDistance', () => {
  it('같은 지점이면 0m', () => {
    expect(calculateDistance(GANGNAM, GANGNAM)).toBe(0);
  });

  it('정수(m)를 반환한다', () => {
    expect(Number.isInteger(calculateDistance(GANGNAM, YEOKSAM))).toBe(true);
  });

  it('강남역~역삼역은 약 830m (±50m)', () => {
    const d = calculateDistance(GANGNAM, YEOKSAM);
    expect(d).toBeGreaterThanOrEqual(780);
    expect(d).toBeLessThanOrEqual(880);
  });

  it('서울시청~부산시청은 약 325km (±5km)', () => {
    const d = calculateDistance(SEOUL_CITY_HALL, BUSAN_CITY_HALL);
    expect(Math.abs(d - 325_000)).toBeLessThanOrEqual(5_000);
  });

  it('경선 위 위도 1도는 πR/180 ≈ 111,195m', () => {
    expect(calculateDistance({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBe(111_195);
  });

  it('방향과 무관하게 대칭이다', () => {
    expect(calculateDistance(GANGNAM, YEOKSAM)).toBe(calculateDistance(YEOKSAM, GANGNAM));
  });
});

describe('sortByDistance', () => {
  interface Place {
    id: string;
    coord?: Coordinate | null;
  }

  const places: Place[] = [
    { id: 'busan', coord: BUSAN_CITY_HALL },
    { id: 'no-coord-null', coord: null },
    { id: 'yeoksam', coord: YEOKSAM },
    { id: 'no-coord-undefined' },
    { id: 'cityhall', coord: SEOUL_CITY_HALL },
    { id: 'gangnam', coord: GANGNAM },
  ];

  const sortFromGangnam = (items: Place[]) => sortByDistance(items, GANGNAM, (p) => p.coord);

  it('가까운 순으로 정렬한다', () => {
    const ids = sortFromGangnam(places).map((p) => p.id);
    expect(ids.slice(0, 4)).toEqual(['gangnam', 'yeoksam', 'cityhall', 'busan']);
  });

  it('좌표가 없는(null/undefined) 아이템은 원래 순서대로 맨 뒤에 놓인다', () => {
    const ids = sortFromGangnam(places).map((p) => p.id);
    expect(ids.slice(-2)).toEqual(['no-coord-null', 'no-coord-undefined']);
  });

  it('원본 배열을 변형하지 않고 새 배열을 반환한다', () => {
    const snapshot = places.map((p) => p.id);
    const sorted = sortFromGangnam(places);

    expect(sorted).not.toBe(places);
    expect(places.map((p) => p.id)).toEqual(snapshot);
    expect(sorted).toHaveLength(places.length);
    // 아이템 자체는 같은 참조를 유지한다 (복제하지 않음)
    expect(sorted).toEqual(expect.arrayContaining(places));
  });

  it('동결된 배열도 처리한다', () => {
    const frozen = Object.freeze([...places]);
    expect(() => sortByDistance(frozen, GANGNAM, (p) => p.coord)).not.toThrow();
  });

  it('빈 배열이면 빈 배열', () => {
    expect(sortFromGangnam([])).toEqual([]);
  });
});
