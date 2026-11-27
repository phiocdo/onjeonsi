/**
 * 전시 상세 창의 "카카오맵" 링크.
 *
 * 1. 연결된 시설 파일에 kakaoPlaceId가 있으면 장소 페이지(place.map.kakao.com/{id})로 바로 간다.
 * 2. 없으면 우선 좌표 핀 지도(없으면 이름 검색)로 두고, 상세 창이 열린 뒤 카카오 JS SDK의 장소 검색으로
 *    장소 페이지를 찾는다. 찾으면 링크를 바꾸고, 못 찾으면 1의 링크를 그대로 쓴다.
 *    고르는 규칙은 kakaoPlace.ts의 pickPlace (이름이 확실히 맞을 때만).
 * 장소 ID가 없는 전시를 열면 지도 화면이 아니어도 SDK 본체를 마저 받는다(의도한 동작).
 */
import { useEffect, useState } from 'react';
import type { CatalogEntry } from './catalog';
import type { Venue } from '../types';
import {
  PLACE_SEARCH_RADIUS,
  findPlace,
  kakaoMapUrl,
  kakaoPlaceUrl,
  placeSearchQueries,
  type KakaoPlace,
  type LatLng,
} from './kakaoPlace';

/** 이 파일이 쓰는 SDK 부분만. window.kakao의 전역 타입은 NearbyExhibitions.tsx가 따로 선언한다 */
interface PlacesService {
  keywordSearch: (
    query: string,
    done: (data: KakaoPlace[], status: string) => void,
    options: { x: number; y: number; radius: number },
  ) => void;
}
interface PlacesServices {
  Status: { OK: string; ZERO_RESULT: string };
  Places: new () => PlacesService;
}
interface KakaoPlacesSdk {
  maps?: { load: (fn: () => void) => void; services?: PlacesServices };
}

/** SDK 본체를 기다리는 시간(ms). 키·도메인 오류면 load 콜백이 오지 않는다 */
const SDK_LOAD_TIMEOUT_MS = 8000;

/** 서울시 API는 좌표가 비면 0을, auto.json은 null을 준다 */
function usableCoord(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0) return null;
  return { lat, lng };
}

/**
 * 링크에 쓸 시설. 이름·별칭이나 venue-links로 연결된 시설은 그대로 쓴다.
 * 좌표로만 연결된 시설(matchVenue by 'coord')은 전시 장소 이름이 따로 읽히면 100m 안의 다른 곳일 수 있어 쓰지 않는다.
 * 장소 이름 칸이 운영시간 문구처럼 망가져 좌표밖에 없을 때만 쓴다.
 */
function linkedVenue(entry: CatalogEntry): Venue | null {
  const { venue, match, exhibition } = entry;
  if (!venue) return null;
  if (match.by !== 'coord') return venue;
  return placeSearchQueries(exhibition.placeName ?? '').length ? null : venue;
}

/**
 * 링크 대상. searchName은 장소 검색에 쓸 이름(시설 이름 → 전시 장소 이름)이고, 없으면 검색하지 않는다.
 * label은 핀 지도·이름 검색 링크에 붙일 이름으로, 장소 이름이 없으면 전시 제목을 쓴다.
 * 좌표는 전시 좌표 → 시설 좌표 순이다.
 */
function placeTarget(entry: CatalogEntry) {
  const venue = linkedVenue(entry);
  const { exhibition } = entry;
  const searchName = venue?.name || exhibition.placeName?.trim() || '';
  const pos = usableCoord(exhibition.lat, exhibition.lng) ?? (venue ? usableCoord(venue.lat, venue.lng) : null);
  return { venue, searchName, label: searchName || exhibition.title, pos };
}

/** 처음 보여줄 링크. 시설에 장소 ID가 있으면 장소 페이지, 없으면 좌표 핀 지도나 이름 검색 */
export function kakaoMapLink(entry: CatalogEntry): string {
  const { venue, label, pos } = placeTarget(entry);
  if (venue?.kakaoPlaceId) return kakaoPlaceUrl(venue.kakaoPlaceId);
  return kakaoMapUrl(label, pos);
}

/** SDK를 마저 불러오고(autoload=false) 장소 검색 서비스를 돌려준다. SDK가 없으면 null, 시간이 넘으면 실패 */
function loadServices(): Promise<PlacesServices | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const maps = (window as unknown as { kakao?: KakaoPlacesSdk }).kakao?.maps;
  if (!maps) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('카카오맵 SDK 로딩 시간 초과')), SDK_LOAD_TIMEOUT_MS);
    maps.load(() => {
      clearTimeout(timer);
      resolve(maps.services ?? null);
    });
  });
}

// 같은 전시는 한 번만 찾는다. 결과 없음(null)은 기억하고, 오류는 지워서 다음에 다시 찾는다
const searched = new Map<string, Promise<string | null>>();

/** 장소 ID가 없는 전시의 장소 페이지 주소를 찾는다. 찾을 필요가 없거나 못 찾으면 null */
export function searchPlaceLink(entry: CatalogEntry): Promise<string | null> {
  const key = entry.exhibition.id;
  const cached = searched.get(key);
  if (cached) return cached;

  const { venue, searchName, pos } = placeTarget(entry);
  const job =
    venue?.kakaoPlaceId || !searchName || !pos
      ? Promise.resolve(null)
      : loadServices()
          .then((services) => {
            if (!services) return null;
            const places = new services.Places();
            const search = (query: string, at: LatLng) =>
              new Promise<KakaoPlace[]>((resolve, reject) =>
                places.keywordSearch(
                  query,
                  (data, status) => {
                    if (status === services.Status.OK) resolve(data);
                    else if (status === services.Status.ZERO_RESULT) resolve([]);
                    else reject(new Error(`카카오 장소 검색 실패: ${status}`));
                  },
                  { x: at.lng, y: at.lat, radius: PLACE_SEARCH_RADIUS },
                ),
              );
            return findPlace(searchName, pos, search);
          })
          .then((place) => (place ? kakaoPlaceUrl(place.id) : null))
          .catch(() => {
            searched.delete(key);
            return null;
          });
  searched.set(key, job);
  return job;
}

/** 상세 창이 연 전시의 장소 페이지 주소. 찾는 중이거나 못 찾으면 null → kakaoMapLink 결과를 쓴다 */
export function useKakaoPlaceLink(entry: CatalogEntry | undefined): string | null {
  const [found, setFound] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    if (!entry) return;
    let alive = true;
    void searchPlaceLink(entry).then((url) => {
      if (alive && url) setFound({ id: entry.exhibition.id, url });
    });
    return () => {
      alive = false;
    };
  }, [entry]);

  // 다른 전시로 넘어가면 이전 전시에서 찾은 주소를 쓰지 않는다
  return entry && found?.id === entry.exhibition.id ? found.url : null;
}
