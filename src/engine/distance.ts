/** 위경도 좌표 (WGS84, 도 단위). 외부 타입에 의존하지 않도록 엔진 내부에 둔다. */
export interface Coordinate {
  lat: number;
  lng: number;
}

/** 지구 평균 반지름 (m) */
const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Haversine 공식으로 두 좌표 사이의 대원 거리를 구한다.
 * @returns 거리 (m, 반올림한 정수)
 */
export function calculateDistance(origin: Coordinate, target: Coordinate): number {
  const dLat = toRad(target.lat - origin.lat);
  const dLng = toRad(target.lng - origin.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(origin.lat)) * Math.cos(toRad(target.lat)) * Math.sin(dLng / 2) ** 2;

  // 부동소수 오차로 a가 [0, 1]을 살짝 벗어나는 경우를 막는다.
  const c = 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));

  return Math.round(EARTH_RADIUS_M * c);
}

/**
 * 기준 좌표에서 가까운 순으로 정렬한 새 배열을 반환한다. 원본 배열은 건드리지 않는다.
 * `getCoord`가 null/undefined를 반환하는 아이템은 맨 뒤로 보내며, 그들끼리는 원래 순서를 유지한다.
 * 거리가 같은 아이템도 원래 순서를 유지한다 (안정 정렬).
 */
export function sortByDistance<T>(
  items: readonly T[],
  origin: Coordinate,
  getCoord: (item: T) => Coordinate | null | undefined,
): T[] {
  // 비교마다 거리를 다시 계산하지 않도록 먼저 한 번씩만 계산해 둔다.
  const withDistance = items.map((item) => {
    const coord = getCoord(item);
    return {
      item,
      distance: coord == null ? Number.POSITIVE_INFINITY : calculateDistance(origin, coord),
    };
  });

  withDistance.sort((a, b) => {
    if (a.distance === b.distance) return 0; // Infinity === Infinity 포함
    return a.distance - b.distance;
  });

  return withDistance.map(({ item }) => item);
}
