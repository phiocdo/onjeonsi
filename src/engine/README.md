# src/engine

전시 관람 가능 여부를 판정하는 엔진입니다.

## 1. 엔진이 하는 일

- 규칙 기반 순수 함수 모음입니다. AI를 쓰지 않습니다.
- 같은 입력에는 항상 같은 결과를 냅니다.
- 화면(React)과 서버에 의존하지 않습니다. 데이터는 호출하는 쪽이 넘깁니다.
- 판정 결과는 세 가지입니다: `possible`(가능), `impossible`(불가), `unknown`(확인 필요).

## 2. 파일 지도

| 파일 | 하는 일 |
| --- | --- |
| `judge.ts` | 전시 하나를 날짜·머무는 시간으로 판정합니다. 엔진의 중심입니다. |
| `isOpen.ts` | 시설이 그날 문을 여는지 봅니다. `judge`가 씁니다. |
| `time.ts` | `HH:MM`, `YYYY-MM-DD` 계산 도우미입니다. |
| `reasons.ts` | 판정 사유 문구(`REASONS`)를 한곳에서 정의합니다. |
| `constants.ts` | 기본값(`DEFAULT_VISIT_MINUTES = 60`)입니다. |
| `stats.ts` | 리뷰 집계(평균 별점, 관람 시간 중앙값)입니다. 판정과 별개입니다. |
| `distance.ts` | 두 좌표 사이 거리, 거리순 정렬입니다. |
| `sort.ts` | 판정 결과로 전시 목록을 정렬합니다. (PR #25 대기: 병합 후 사용 가능) |
| `slots.ts` | 30분 간격 입장 후보 시각을 찾습니다. (PR #25 대기: 병합 후 사용 가능) |

`index.ts`가 없습니다. import는 파일별로 씁니다.

```ts
import { judge } from './engine/judge';
import { calculateDistance } from './engine/distance';
```

## 3. 빠른 시작

아래 예시는 `src/` 안의 파일에서 부르는 것으로 가정합니다.
예시 시설은 가상 데이터입니다: 매일 10:00-18:00, 월요일 휴관, 입장 마감 17:00, 관람 60분.

### 판정 하나

```ts
import type { Venue, Exhibition } from './types';
import { judge } from './engine/judge';

const venue: Venue = {
  id: 'sample-museum',
  name: '예시 미술관',
  aliases: [],
  gu: '종로구',
  type: '미술관',
  lat: 37.5796,
  lng: 126.9770,
  representative: false,
  hours: {
    mon: { open: '10:00', close: '18:00' },
    tue: { open: '10:00', close: '18:00' },
    wed: { open: '10:00', close: '18:00' },
    thu: { open: '10:00', close: '18:00' },
    fri: { open: '10:00', close: '18:00' },
    sat: { open: '10:00', close: '18:00' },
    sun: { open: '10:00', close: '18:00' },
  },
  closed: { weekday: 'mon', ifHoliday: 'nextDay' },
  lastEntry: '17:00',
  visitMinutes: 60,
  source: '예시',
  verified: '2026-11-14',
};

const exhibition: Exhibition = {
  id: 'sample-exhibition',
  venueId: 'sample-museum',
  title: '예시 전시',
  start: '2026-11-01',
  end: '2026-12-31',
};

const holidays: string[] = []; // 실제로는 data/holidays/holidays.json

console.log(judge({ venue, exhibition, date: '2026-11-21', stayStart: '09:30', stayEnd: '12:00', holidays }));
console.log(judge({ venue, exhibition, date: '2026-11-23', stayStart: '09:30', stayEnd: '12:00', holidays }));
console.log(judge({ venue, exhibition, date: '2026-11-21', stayStart: '16:30', stayEnd: '18:00', holidays }));

// 실행 결과 (tsx로 확인)
// 토요일, 09:30 도착 → 개관 시각 10:00으로 당겨 입장
// { result: 'possible', reasons: [], entryTime: '10:00', endTime: '11:00', slackMinutes: 60 }
// 월요일
// { result: 'impossible', reasons: [ '월요일 휴관입니다' ] }
// 토요일, 16:30 도착 → 입장 마감 17:00 전이고 폐관까지 30분 남음
// { result: 'possible', reasons: [], entryTime: '16:30', endTime: '17:30', slackMinutes: 30 }
```

### 내 동네 전시 목록

순서: 거리 붙이기 → 반경으로 거르기 → 시설 JSON이 있는 전시만 판정 → 정렬.

```ts
import type { Venue, Exhibition, JudgeResult } from './types';
import exhibitions from '../data/exhibitions/auto.json';
import holidays from '../data/holidays/holidays.json';
import { judge } from './engine/judge';
import { calculateDistance } from './engine/distance';
import { rankExhibitions } from './engine/sort'; // PR #25 병합 후

const me = { lat: 37.5759, lng: 126.9768 };
const RADIUS_M = 1000;
const venues: Venue[] = [venue]; // 시설 JSON (지금 main에는 없음)
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

// 1) 좌표가 있는 전시만 거리를 붙이고 반경으로 거른다 (auto.json에 lat: null이 있다)
const nearby = (exhibitions as Exhibition[])
  .filter((ex) => Number.isFinite(ex.lat) && Number.isFinite(ex.lng))
  .map((ex) => ({ ex, distance: calculateDistance(me, { lat: ex.lat!, lng: ex.lng! }) }))
  .filter((row) => row.distance <= RADIUS_M);

// 2) 시설 JSON이 있으면 judge, 없으면 화면에서 '확인 필요'로 보여 준다
const judged = nearby.map(({ ex, distance }) => {
  const v = venues.find((x) => x.id === ex.venueId);
  const result: JudgeResult = v
    ? judge({ venue: v, exhibition: ex, date: today, stayStart: '14:00', stayEnd: '17:00', holidays })
    : { result: 'unknown', reasons: [] }; // 시설 정보 없음 사유는 REASONS에 추가 예정
  return { id: ex.id, title: ex.title, distance, judge: result };
});

// 3) 판정 → 여유 시간 → 거리 → id 순으로 정렬
const list = rankExhibitions(judged);
// 결과: 지금 데이터는 auto.json의 venueId가 모두 빈 문자열이라
// 시설을 찾지 못해 모두 unknown이 된다
```

`calculateDistance` 결과 예시 (위 `me`에서 예시 시설까지):

```ts
calculateDistance({ lat: 37.5759, lng: 126.9768 }, { lat: 37.5796, lng: 126.9770 });
// 412 (m, tsx로 확인)
```

판정 없이 거리순만 필요하면 `sortByDistance`를 씁니다. 판정과 여유 시간까지 보고 정렬하려면 `rankExhibitions`를 씁니다.

### 언제 갈까 후보

```ts
import { judge } from './engine/judge';
import { findStartCandidates } from './engine/slots'; // PR #25 병합 후

const candidates = findStartCandidates(
  { venue, exhibition, date: '2026-11-21', holidays },
  [
    { start: '09:00', end: '12:00' },
    { start: '16:00', end: '18:00' },
  ],
  judge,
);
// 실행 결과
// { possible: ['10:00', '10:30', '11:00'], unavailable: [], unknown: [] }
// 09:00 출발은 개관 시각 10:00 입장으로 당겨진다.
// limit 3이 첫 구간에서 다 차서 16:00 구간은 결과에 없다.
```

### 실제 데이터 상태

지금 main에는 시설 JSON이 없습니다. 전시(`auto.json`)의 `venueId`도 모두 빈 문자열입니다.
그래서 실제 데이터로는 아직 판정할 수 없습니다.
시설 JSON을 작성하고 전시와 시설을 `venueId`로 연결한 뒤에 동작합니다.

## 4. 함수별 사용법

### judge (`judge.ts`)

```ts
export type JudgeFn = (input: JudgeInput) => JudgeResult;
export const judge: JudgeFn;
```

- 입력 `JudgeInput`: `venue`, `exhibition`, `date`, `stayStart`, `stayEnd`, `holidays`.
- `Exhibition`에서는 `start`, `end`만 읽습니다.
- `Venue`에서는 `hours`, `closed`, `lastEntry`, `visitMinutes`를 읽습니다.
- 관람 시간은 `venue.visitMinutes ?? DEFAULT_VISIT_MINUTES`(60)입니다. 0은 0분으로 봅니다.
- 출력 `JudgeResult`: `result`, `reasons`, 그리고 가능일 때만 `entryTime`, `endTime`, `slackMinutes`.

### isOpen (`isOpen.ts`)

```ts
export function isOpen(venue: Venue, date: string, holidays: string[]): OpenStatus;
```

- 출력 `OpenStatus`
  - `{ status: 'open'; open; close; lastEntry? }`
  - `{ status: 'closed'; reason }`
  - `{ status: 'unknown'; reason }`
- 규칙은 5장을 봅니다.

### time (`time.ts`)

```ts
export function toMinutes(hhmm: string): number | null; // '10:30' → 630, 형식 오류는 null
export function fromMinutes(n: number): string;         // 630 → '10:30'
export function weekdayOf(date: string): Weekday;       // '2026-11-23' → 'mon'
export function addDays(date: string, n: number): string;
```

### stats (`stats.ts`)

```ts
export function isValidReview(r: ReviewInput): boolean;
export function summarizeReviews(reviews: ReviewInput[]): ReviewStats;
```

- 입력 `ReviewInput`: `rating`, `visitMinutes`.
- 유효한 리뷰만 셉니다: 별점은 1-5 정수, 관람 시간은 10-480분.
- 유효한 리뷰가 3건(`MIN_COUNT`) 미만이면 `averageRating`, `medianMinutes`가 `null`입니다.
- `averageRating`은 소수 첫째 자리로 반올림합니다.
- `medianMinutes`는 짝수 개면 가운데 두 값의 평균입니다.
- 출력 `ReviewStats`: `count`, `averageRating`, `medianMinutes`.

### distance (`distance.ts`)

```ts
export interface Coordinate { lat: number; lng: number; }
export function calculateDistance(origin: Coordinate, target: Coordinate): number;
export function sortByDistance<T>(
  items: readonly T[],
  origin: Coordinate,
  getCoord: (item: T) => Coordinate | null | undefined,
): T[];
```

- `calculateDistance`: Haversine 거리(m, 반올림 정수).
- `sortByDistance`: 가까운 순으로 새 배열을 돌려줍니다. 원본은 그대로입니다.
  - `getCoord`가 `null`/`undefined`를 돌려준 항목은 맨 뒤로 갑니다.
  - 거리가 같으면 원래 순서를 지킵니다.

### rankExhibitions (`sort.ts`) (PR #25 대기: 병합 후 사용 가능)

```ts
type Rankable = { judge: JudgeResult; distance?: number; id: string };
export function rankExhibitions<T extends Rankable>(items: T[]): T[];
```

- 새 배열을 돌려줍니다. 입력은 그대로입니다.
- 정렬 순서
  1. 판정: 가능 → 확인 필요 → 불가
  2. 여유 시간(`slackMinutes`) 많은 순. 값이 없으면 뒤로.
  3. 거리(`distance`) 가까운 순. `null`/`undefined`/`NaN`이면 뒤로.
  4. `id` 문자열 순.
- 여유 시간 0은 정상 값입니다. 값 없음과 다르게 취급합니다.

### findStartCandidates (`slots.ts`) (PR #25 대기: 병합 후 사용 가능)

```ts
export function findStartCandidates(
  input: Omit<JudgeInput, 'stayStart' | 'stayEnd'>,
  ranges: { start: string; end: string }[],
  judge: JudgeFn,
  limit = 3,
): StartCandidates;
```

- `judge`를 인자로 받습니다. 운영 시간·휴관 판단은 전부 `judge`에 맡깁니다.
- 관람 시간은 `input.venue.visitMinutes ?? DEFAULT_VISIT_MINUTES`(60)입니다. `judge`와 같습니다. 0은 0분으로 봅니다.
- 시간대(`ranges`) 처리
  - 형식 오류(`HH:MM` 아님)와 시작 >= 끝인 구간은 건너뜁니다.
  - 시작 시각 순으로 정렬합니다.
  - 겹치거나 맞닿은 구간은 하나로 합칩니다. 끝은 늦은 쪽입니다.
  - 떨어진 구간은 따로 처리합니다.
- 각 구간에서 시작 시각을 30분 단위로 올립니다(10:10 → 10:30).
- 출발 시각 + 관람 시간 <= 구간 끝인 동안 30분씩 `judge`에 묻습니다. `stayEnd`는 구간 끝입니다.
- 출력 `StartCandidates` (모두 이른 시각 순)
  - `possible: string[]`: 실제 입장 시각입니다(`entryTime`, 개관 전 출발이면 개관 시각으로 당겨진 값). 중복 없이 최대 `limit`개.
  - `unknown: string[]`: 확인 필요인 출발 시각.
  - `unavailable: { range: string; reason: string }[]`: 불가 구간.
    - `range`는 한 시각(`'10:00'`) 또는 같은 사유가 이어진 범위(`'10:00~11:30'`)입니다.
    - `range`는 입장 시각이 아니라 출발 시각 범위입니다. 화면에는 '입장 불가'로 표시합니다.
    - 사유가 여러 개면 `reason`은 `', '`로 이어 붙인 문자열입니다.

## 5. 판정 규칙

### 운영 여부 (`isOpen`)

먼저 걸리는 규칙이 이깁니다.

1. 지정 휴관일(`closed.dates`)이면 휴관. `'YYYY-MM-DD'` 또는 매년 `'MM-DD'`.
2. 정기 휴관 요일(`closed.weekday`)이면 휴관. 단, 그날이 공휴일이고 `ifHoliday`가 `'nextDay'`면 개관.
3. 전날이 공휴일과 겹친 휴관 요일이면 휴관(`ifHoliday`가 `'nextDay'`일 때).
4. 그 요일의 `hours`가 없으면 `unknown`.
5. 나머지는 `open`. 그 요일의 `open`, `close`와 시설의 `lastEntry`를 돌려줍니다.

### 필수 조건

기호: `s` = 실제 입장 시각, `d` = 관람 시간.

- `s = max(stayStart, open)`
- `d = visitMinutes ?? 60`

5개를 모두 만족해야 가능입니다.

1. 전시 기간 안: `exhibition.start <= date <= exhibition.end`
2. 운영일: `isOpen`이 `open`
3. `s <= lastEntry`
4. `s + d <= close`
5. `s + d <= stayEnd`

### 출력

- `entryTime` = `s`
- `endTime` = `s + d`
- `slackMinutes` = `min(close, stayEnd) - (s + d)`

### 사유 처리

- 사유는 쌓입니다. 예: 기간 밖이면서 휴관이면 사유 2개.
- 휴관이거나 운영 여부를 모르면 시간 조건(3-5)은 검사하지 않습니다.
- 불가 사유가 하나라도 있으면 `impossible`입니다. 정보 없음 사유는 버립니다.
- 불가 사유 없이 정보 없음 사유만 있으면 `unknown`입니다.
- `lastEntry`만 없고(또는 형식 오류) 다른 조건을 다 만족하면 `unknown`(`MISSING_LAST_ENTRY`)입니다.
- 시각 형식 오류는 `MISSING_HOURS`로 `unknown`입니다(8장 참고).

## 6. 데이터 규칙

- 판정은 시설 JSON(`Venue`)만 근거로 합니다.
  - 전시의 `operatingHours`는 PR #22(미병합)에서 제안된 표시용 필드입니다. 판정에는 쓰지 않습니다.
  - 전시의 `hoursText`도 판정에 쓰지 않습니다.
- 시각은 `HH:MM` 두 자리입니다. `9:00`, `24:00`은 형식 오류로 `unknown`이 됩니다.
- 날짜는 0을 채운 `YYYY-MM-DD` 문자열입니다.
  - 문자열 그대로 비교합니다.
  - `new Date('YYYY-MM-DD')`는 쓰지 않습니다. UTC로 해석되어 날짜가 밀릴 수 있습니다.
- 오늘 날짜는 서울 기준으로 만듭니다.

  ```ts
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // '2026-11-14'
  ```

- `holidays`는 호출하는 쪽에서 `data/holidays/holidays.json`을 읽어 넘깁니다. 엔진은 파일을 읽지 않습니다.
- 좌표는 `Number.isFinite`로 확인한 뒤 씁니다. `auto.json`에 `lat: null`이 있습니다.
- `lastEntry`는 시설 전체에 하나입니다. 요일별로 다르게 둘 수 없습니다.
- 작성 규칙은 팀 Notion의 'JSON 데이터 작성 가이드'를 참고합니다.

## 7. 사유 문구 (`REASONS`)

| 키 | 문구 | 쓰이는 곳 |
| --- | --- | --- |
| `OUT_OF_PERIOD` | 전시 기간이 아닙니다 | 전시 기간 밖 |
| `CLOSED_DATE` | 임시 휴관일입니다 | 지정 휴관일 |
| `CLOSED_WEEKDAY(weekdayLabel)` | `{요일}요일 휴관입니다` | 정기 휴관 요일 |
| `CLOSED_HOLIDAY` | 공휴일 휴관입니다 | 공휴일 다음 날 대체 휴관 |
| `AFTER_LAST_ENTRY(lastEntry)` | `입장 마감({lastEntry}) 이후입니다` | `s > lastEntry` |
| `NOT_ENOUGH_BEFORE_CLOSE` | 폐관 전까지 관람 시간이 부족합니다 | `s + d > close` |
| `NOT_ENOUGH_STAY` | 머물 수 있는 시간 안에 관람을 마칠 수 없습니다 | `s + d > stayEnd` |
| `MISSING_HOURS` | 운영 시간 정보가 없습니다 | 요일별 `hours` 없음, 시각 형식 오류 |
| `MISSING_LAST_ENTRY` | 입장 마감 정보가 없습니다 | `lastEntry` 없음 또는 형식 오류 |
| `NOT_IMPLEMENTED` | 판정 로직 구현 전입니다 | 쓰지 않음 |

- `CLOSED_HOLIDAY`는 '공휴일 다음 날 대체 휴관'에 쓰입니다. 문구가 '공휴일 휴관입니다'라 실제와 맞지 않습니다. 수정 예정입니다.
- `NOT_IMPLEMENTED`는 스텁 시절 값입니다. `judge`에서 쓰지 않습니다.

## 8. 알려진 한계

- 휴관 요일은 하나만 지정할 수 있습니다(`closed.weekday`).
- 연휴가 이어질 때 대체 휴관 처리가 단순합니다. 전날 하루만 봅니다. 실제 시설 규칙 확인이 필요합니다.
- 자정을 넘는 운영과 `24:00`은 지원하지 않습니다.
- 입력 형식 오류가 `MISSING_HOURS`(운영 시간 정보 없음)로 표시됩니다. `INVALID_INPUT`으로 분리할 예정입니다.
- `stayEnd < stayStart`인지 검사하지 않습니다. 이때는 보통 `NOT_ENOUGH_STAY`로 불가가 됩니다.
- 전시별 운영 시간(`hoursText`)은 무시합니다. 전시가 시설보다 일찍 닫아도 반영되지 않습니다.
- `stats`의 `medianMinutes`는 아직 판정의 관람 시간(`visitMinutes`)과 연결되지 않았습니다.
- TypeScript 6부터 `strict`가 기본으로 켜집니다(`tsconfig`에 따로 적지 않음). 선택 필드(`lastEntry`, `hours` 등)는 `undefined`인지 확인해야 컴파일됩니다.

## 9. 화면에서 쓸 때

지금 화면은 엔진을 쓰지 않습니다. 아래가 교체 대상입니다.

- `src/pages/NearbyExhibitions.tsx`
  - 판정: 목 데이터(`mockItems`)의 `judgeResult`를 돌려 씁니다 → `judge`로 교체.
  - 거리: 자체 함수 `distanceMeters`를 씁니다 → `calculateDistance`로 교체.
  - 정렬: → `rankExhibitions`로 교체(PR #25 병합 후).
- `src/pages/When.tsx`
  - `src/mock/exhibits`의 목 데이터를 씁니다 → `judge`, `findStartCandidates`로 교체(PR #25 병합 후).

## 10. 테스트 실행

```bash
npm test                                  # 전체 한 번 실행 (vitest run)
npm run test:watch                        # 파일이 바뀔 때마다 다시 실행
npx vitest run src/engine/judge.test.ts   # 파일 하나
npx vitest run -t "휴관"                  # 테스트 이름으로 거르기
```

## 11. 규칙을 바꿀 때 같이 고칠 곳

- `src/engine/reasons.ts`: 사유 문구
- `src/engine/constants.ts`: 기본값
- `src/engine/*.test.ts`: 테스트
- `src/types`: `Venue`, `Exhibition`, `JudgeInput`, `JudgeResult` 타입
- `schema/`: JSON 스키마 (PR #28 병합 후)
- 팀 Notion의 'JSON 데이터 작성 가이드'
- `src/mock`: 목 데이터의 판정 문구
- `src/pages/Team.tsx`: 구조 설명
