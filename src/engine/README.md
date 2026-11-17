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
| `matchVenue.ts` | 전시의 장소 이름·좌표로 시설(`venueId`)을 찾습니다. |
| `resolveSchedule.ts` | 시설 정보와 전시 운영 시간을 합쳐 판정에 쓸 시설 정보(`ResolvedVenue`)를 만듭니다. `judgeResolved`도 여기 있습니다. |
| `scheduleForDate.ts` | 전시 운영 시간에서 판정 날짜의 일정을 고릅니다(날짜 예외, 기간, 공휴일, 몇째 주). 회차 판단(`isSessionDay`)도 여기 있습니다. |
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
// { result: 'possible', reasons: [], entryTime: '10:00', endTime: '11:00', slackMinutes: 60, basis: 'venue' }
// 월요일
// { result: 'impossible', reasons: [ '월요일 휴관입니다' ], basis: 'venue' }
// 토요일, 16:30 도착 → 입장 마감 17:00 전이고 폐관까지 30분 남음
// { result: 'possible', reasons: [], entryTime: '16:30', endTime: '17:30', slackMinutes: 30, basis: 'venue' }
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
const venues: Venue[] = [venue]; // 시설 JSON (data/venues/*.json)
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

시설 JSON은 `data/venues/`에 있습니다(6개).
하지만 전시(`auto.json`)의 `venueId`가 모두 빈 문자열이라 전시와 시설이 아직 연결되지 않습니다.
그래서 실제 데이터로는 아직 판정할 수 없습니다. 전시와 시설을 `venueId`로 연결한 뒤에 동작합니다.

## 4. 함수별 사용법

### judge (`judge.ts`)

```ts
export type JudgeFn = (input: JudgeInput) => JudgeResult;
export const judge: JudgeFn;
```

```ts
export interface ResolvedInterval { open: string; close: string; lastEntry?: string }

export type ResolvedVenue = Venue & {
  lastEntryByDay?: Partial<Record<Weekday, string>>;
  intervalsByDay?: Partial<Record<Weekday, ResolvedInterval[]>>;
  basis?: 'venue' | 'exhibition' | 'merged';
};
```

- 입력 `JudgeInput`: `venue`, `exhibition`, `date`, `stayStart`, `stayEnd`, `holidays`.
- `Exhibition`에서는 `start`, `end`만 읽습니다.
- `Venue`에서는 `hours`, `closed`, `lastEntry`, `visitMinutes`를 읽습니다.
- `venue`에 `ResolvedVenue`를 넘기면 `lastEntryByDay`, `intervalsByDay`, `basis`도 읽습니다. `Venue` 타입 자체에는 이 필드가 없습니다.
  - `lastEntryByDay`: 요일별 입장 마감. 그 요일 값이 있으면 `lastEntry` 대신 씁니다.
  - `intervalsByDay`: 하루에 구간이 여러 개인 요일(점심 휴관 등). 그 요일은 `hours` 대신 이 구간들로 판정합니다.
    `hours`에는 첫 구간 시작 ~ 마지막 구간 끝이 들어 있습니다(휴관·운영 여부는 `hours`로 봅니다).
    구간의 `lastEntry`가 없으면 시설 `lastEntry`를 씁니다. 시설 데이터(`Venue.hours`)는 지금처럼 요일당 구간 하나입니다.
  - `basis`: 시설 정보가 어디서 왔는지. 결과의 `basis`로 그대로 나갑니다.
- 관람 시간은 `venue.visitMinutes ?? DEFAULT_VISIT_MINUTES`(60)입니다. 0은 0분으로 봅니다.
- 출력 `JudgeResult`: `result`, `reasons`, `basis`, 그리고 가능일 때만 `entryTime`, `endTime`, `slackMinutes`, `lastEntryAssumed`.
  - `basis`는 모든 결과에 들어갑니다. `venue.basis`가 없으면 `'venue'`입니다.
  - `lastEntryAssumed: true`: 그날 입장 마감 정보가 없어 폐관 시각을 입장 마감으로 보고 "가능"을 냈다는 표시입니다.
    입장 마감이 데이터에 있으면 넣지 않습니다. 불가·확인 필요에는 넣지 않습니다(5장 참고).

### resolveSchedule, judgeResolved (`resolveSchedule.ts`)

```ts
export function resolveSchedule(
  venue: Venue | null,
  hours: ParsedOperatingHours | undefined, // 보통 exhibition.operatingHours
  options = { useExhibitionHours: false },
): { venue: ResolvedVenue | null; basis: 'venue' | 'exhibition' | 'merged' | null; mismatches: Mismatch[] };

export function judgeResolved(input: Omit<JudgeInput, 'venue'>, resolved: ResolveResult): JudgeResult;
```

```ts
const resolved = resolveSchedule(venue ?? null, ex.operatingHours, { useExhibitionHours: true });
const result = judgeResolved({ exhibition: ex, date, stayStart, stayEnd, holidays }, resolved);
// resolved.venue가 null이면 { result: 'unknown', reasons: [MISSING_VENUE] }
```

- 전시 쪽은 "믿을 수 있는 요일"만 씁니다: `scheduleType`이 `'scheduled'`이고, 그 요일이 `isOpen: true`, 구간이 하나 이상, 각 구간 `open < close`, 구간끼리 겹치지 않음, 회차 요일이 아님(`isSessionDay`). 나머지 요일은 "모름"입니다(`isOpen: false`도 "모름").
- `resolveSchedule`은 날짜를 모르므로 기본 요일 일정(`weekdays`)만 봅니다. 날짜별 일정은 `judgeResolved`가 적용합니다.
- 결과
  - 시설만 있음, 플래그 off, 또는 믿을 요일 없음: 시설 그대로, `basis: 'venue'`.
  - 시설 없음 + 플래그 on: 믿을 요일만 `hours`로, `lastAdmission`(폐관 이하)을 입장 마감으로. `closed`는 넣지 않습니다. `basis: 'exhibition'`.
  - 둘 다 + 플래그 on: 휴관 규칙은 시설 것. 전시 구간마다 시설 시간과 겹치는 부분(늦은 개관 ~ 이른 폐관)만 남기고, 하나도 안 겹치면 그 요일은 뺌, 전시가 "모름"이면 시설 시간. 시설에 없는 요일은 넣지 않습니다. 구간 입장 마감 = `min(시설 lastEntry, 전시 lastAdmission, 그 구간 끝)`. `basis: 'merged'`.
  - 그 밖: `venue: null`, `basis: null`.
  - 남은 구간이 하나면 `hours` + `lastEntryByDay`(지금까지와 같음), 여러 개면 `hours`(첫 시작 ~ 마지막 끝) + `intervalsByDay`.
  - 입장 마감이 없으면 지금처럼 비워 둡니다. `judge`가 폐관 시각을 씁니다(`lastEntryAssumed`).
- `source`: 플래그 on이고 `hours`가 `'scheduled'`일 때만 `{ venue, hours, options }`가 들어갑니다. `judgeResolved`가 씁니다.
- `mismatches`: 시설과 전시가 둘 다 있으면 플래그와 상관없이 계산합니다(시설 데이터 점검용). `{ weekday, kind: 'closed' | 'open' | 'close' | 'lastEntry', venueValue, exhibitionValue }`.
  구간이 여러 개인 요일은 첫 구간 시작↔시설 `open`, 마지막 구간 끝↔시설 `close`, 마지막 구간 `lastAdmission`↔시설 `lastEntry`를 비교합니다.
- `judgeResolved`
  - 플래그 off(또는 `source` 없음): `resolved.venue`로 그대로 판정합니다. 지금까지와 같습니다.
  - 플래그 on: 판정 날짜의 일정(`scheduleForDate`)을 다시 골라 그 요일만 바꿔 판정합니다. 전시 일정은 `input.exhibition.operatingHours`, 없으면 `source.hours`입니다.
    - 그날 일정을 믿을 수 있으면 그 일정으로, "모름"이면 지금처럼 믿지 않는 요일로 다룹니다.
    - 확실히 쉬는 날(날짜 예외가 휴관, 공휴일 규칙이 휴관, 몇째 주에 해당하지 않음)은 그 날짜를 `closed.dates`에 넣어 `CLOSED_DATE`로 막습니다. 시설도 그날 쉬면 시설 사유를 그대로 둡니다.
- 입력 `venue`, `hours`는 바꾸지 않습니다.
- 시설 없이 만든 `venue`(`basis: 'exhibition'`)는 판정용입니다. `id`, `name`, 좌표 등은 빈 값이라 화면에 쓰지 않습니다.

### scheduleForDate, isSessionDay (`scheduleForDate.ts`)

```ts
export function scheduleForDate(hours: ParsedOperatingHours, date: string, holidays: string[]): DaySchedule | null;
export function weekOfMonth(date: string): number;      // '2026-11-21' → 3
export function isSessionDay(day: DaySchedule): boolean;
```

```ts
const day = scheduleForDate(ex.operatingHours, '2026-11-21', holidays);
// null: 모름 (scheduleType이 'scheduled'가 아님)
// { isOpen: true, intervals: [{ open: '10:00', close: '18:00' }] }
```

- `scheduleType`이 `'scheduled'`가 아니면 `null`입니다. `always_open`도 `null`입니다(`resolveSchedule`도 `always_open`은 판정에 쓰지 않습니다).
- 우선순위
  1. `exceptions`에 그 날짜가 있으면 그 일정. 아래 4·5를 적용하지 않습니다.
  2. `periods` 중 `from <= date <= to`(없는 쪽은 열림)인 것 가운데 `from`이 가장 늦은 것의 요일 일정
  3. 기본 `weekdays`의 요일 일정
  4. 그 날짜가 공휴일이고 `holiday`가 `null`이 아니면 `holiday` 일정
  5. 고른 요일 일정에 `weeksOfMonth`가 있고 그날의 주가 없으면 휴관(`isOpen: false, intervals: []`)
- 몇째 주(`weekOfMonth`)는 1~7일이 1째 주, 8~14일이 2째 주인 방식입니다. "1, 3째주 토"를 그 달 첫째·셋째 토요일로 읽습니다(달력 주 방식 아님).
- `isSessionDay`: 회차로 운영하는 요일인지. `sessions` 필드가 있으면 그것만, 없으면 `note`에 `'회차'`가 있는지 봅니다. 회차 요일은 "모름"으로 둡니다.
- 입력은 바꾸지 않습니다. 돌려준 객체는 입력의 것일 수 있으니 고치지 않습니다.

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
- 출발 시각 + 관람 시간 <= 구간 끝이고 출발 시각 < 구간 끝인 동안 30분씩 `judge`에 묻습니다. `stayEnd`는 구간 끝입니다.
  - 출발 시각 < 구간 끝은 관람 시간이 0분일 때만 차이가 납니다. 출발 = 구간 끝이면 `judge`가 `INVALID_INPUT`을 내므로 묻지 않습니다.
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

### 입력 검사

다른 조건보다 먼저 봅니다. 하나라도 틀리면 바로 `{ result: 'unknown', reasons: [INVALID_INPUT], basis }`를 돌려줍니다.

- `date`가 `YYYY-MM-DD` 형식이고 달력에 실제 있는 날짜인지. `2026-02-30`은 거부합니다.
- `stayStart`, `stayEnd`가 `HH:MM`(`toMinutes`로 읽힘)인지. `9:00`, `24:00`은 거부합니다.
- `stayEnd`가 `stayStart`보다 늦은지. 같아도 거부합니다.

### 필수 조건

기호: `s` = 실제 입장 시각, `d` = 관람 시간, `le` = 실제로 쓰는 입장 마감.

- `s = max(stayStart, open)`
- `d = visitMinutes ?? 60`
- `le = min(lastEntryByDay[그날 요일] ?? lastEntry, close)`
  - 요일별 입장 마감이 있으면 그 값, 없으면 시설 전체 `lastEntry`.
  - 입장 마감이 그날 폐관보다 늦게 적혀 있으면 폐관 시각까지만 입장할 수 있다고 봅니다.
    예: `lastEntry` 20:00, 그날 폐관 18:00 → `le` = 18:00.
  - 둘 다 없으면 `le = close`(폐관 시각)로 봅니다. 가능이면 `lastEntryAssumed: true`를 붙입니다.
    값은 있는데 형식이 틀리면 `MISSING_LAST_ENTRY`입니다.

5개를 모두 만족해야 가능입니다.

1. 전시 기간 안: `exhibition.start <= date <= exhibition.end`
2. 운영일: `isOpen`이 `open`
3. `s <= le`
4. `s + d <= close`
5. `s + d <= stayEnd`

### 구간이 여러 개인 날 (`intervalsByDay`)

- 구간마다 위 조건 3-5를 따로 봅니다. 구간마다 `open`, `close`, `le`(구간 `lastEntry ?? 시설 lastEntry`, 없으면 구간 끝)가 다릅니다.
- 조건을 모두 만족하는 구간이 하나라도 있으면 가능. 가장 이른 그런 구간의 `s`, `close`로 출력을 만듭니다.
- 모두 안 되면, 위반 없이 정보만 모자란 구간이 있으면 확인 필요, 아니면 불가입니다.
  불가 사유는 "가장 가까웠던 구간" 하나의 것입니다. 가까움 = `max(0, s - le) + max(0, s + d - min(close, stayEnd))`(모자란 분)이 가장 작은 구간, 같으면 이른 구간.
  - 예: 10:00~12:00 / 13:00~18:00(입장 마감 17:00), 관람 60분
    - 11:30~14:30 → 오후 구간 13:00 입장, 가능
    - 11:30~12:45 → 오전 30분, 오후 75분 모자람 → 오전 구간 사유 `NOT_ENOUGH_BEFORE_CLOSE`
    - 17:30~19:00 → 오후 구간 사유 `AFTER_LAST_ENTRY(17:00)`, `NOT_ENOUGH_BEFORE_CLOSE`

### 출력

- `entryTime` = `s`
- `endTime` = `s + d`
- `slackMinutes` = `min(close, stayEnd) - (s + d)`
- `basis` = `venue.basis ?? 'venue'` (모든 결과)
- `lastEntryAssumed` = 가능이고, 그 구간의 입장 마감이 없어 폐관 시각을 썼을 때만 `true`

### 사유 처리

- 사유는 쌓입니다. 예: 기간 밖이면서 휴관이면 사유 2개.
- 휴관이거나 운영 여부를 모르면 시간 조건(3-5)은 검사하지 않습니다.
- 불가 사유가 하나라도 있으면 `impossible`입니다. 정보 없음 사유는 버립니다.
- 불가 사유 없이 정보 없음 사유만 있으면 `unknown`입니다.
- 그날 쓸 입장 마감이 없으면 폐관 시각을 입장 마감으로 씁니다. `MISSING_LAST_ENTRY`를 내지 않습니다.
  - 이때 조건 3(`s <= le`)은 조건 4(`s + d <= close`)에 포함되므로 `AFTER_LAST_ENTRY`도 내지 않습니다(적힌 적 없는 입장 마감 시각을 문구에 넣지 않기 위해).
  - 폐관 기준은 실제 입장 마감보다 느슨합니다. 그래서 불가는 그대로 믿을 수 있고, 가능에만 `lastEntryAssumed`를 붙입니다.
- 입장 마감 값이 있는데 형식이 틀리고 다른 조건을 다 만족하면 `unknown`(`MISSING_LAST_ENTRY`)입니다.
- `AFTER_LAST_ENTRY` 문구에는 보정한 입장 마감(`le`)이 들어갑니다.
- 입력(`date`, `stayStart`, `stayEnd`) 오류는 `INVALID_INPUT`입니다.
- 시설 데이터(`hours`)의 시각 형식 오류는 `MISSING_HOURS`로 `unknown`입니다.

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
- 시설 JSON의 `lastEntry`는 시설 전체에 하나입니다. 요일별 입장 마감(`lastEntryByDay`)은 `resolveSchedule`이 만듭니다.
- 작성 규칙은 팀 Notion의 'JSON 데이터 작성 가이드'를 참고합니다.

## 7. 사유 문구 (`REASONS`)

| 키 | 문구 | 쓰이는 곳 |
| --- | --- | --- |
| `OUT_OF_PERIOD` | 전시 기간이 아닙니다 | 전시 기간 밖 |
| `CLOSED_DATE` | 휴관일로 지정된 날입니다 | 지정 휴관일. 플래그 on에서 전시가 그날 확실히 쉬는 날(날짜 예외 휴관, 공휴일 휴관, 쉬는 주) |
| `CLOSED_WEEKDAY(weekdayLabel)` | `{요일}요일 휴관입니다` | 정기 휴관 요일 |
| `CLOSED_HOLIDAY` | 공휴일 다음 날이라 휴관입니다 | 공휴일 다음 날 대체 휴관 |
| `AFTER_LAST_ENTRY(lastEntry)` | `입장 마감({lastEntry}) 이후입니다` | `s > le` (`le`는 5장 참고). 입장 마감이 없어 폐관 기준이면 쓰지 않음 |
| `NOT_ENOUGH_BEFORE_CLOSE` | 폐관 전까지 관람 시간이 부족합니다 | `s + d > close` |
| `NOT_ENOUGH_STAY` | 머물 수 있는 시간 안에 관람을 마칠 수 없습니다 | `s + d > stayEnd` |
| `MISSING_HOURS` | 운영 시간 정보가 없습니다 | 요일별 `hours` 없음, 시설·구간(`intervalsByDay`) 시각 형식 오류 |
| `MISSING_LAST_ENTRY` | 입장 마감 정보가 없습니다 | 그날 쓸 입장 마감의 형식 오류 (없으면 폐관 시각을 씀) |
| `MISSING_VENUE` | 시설 정보가 없습니다 | 전시에 연결된 시설이 없을 때 (`judge`는 아직 쓰지 않음) |
| `INVALID_INPUT` | 입력한 날짜나 시간이 올바르지 않습니다 | 입력 검사 실패 (5장 참고) |
| `NOT_IMPLEMENTED` | 판정 로직 구현 전입니다 | 쓰지 않음 |

- `NOT_IMPLEMENTED`는 스텁 시절 값입니다. `judge`에서 쓰지 않습니다.

## 8. 알려진 한계

- 휴관 요일은 하나만 지정할 수 있습니다(`closed.weekday`).
- 연휴가 이어질 때 대체 휴관 처리가 단순합니다. 전날 하루만 봅니다. 실제 시설 규칙 확인이 필요합니다.
- 자정을 넘는 운영과 `24:00`은 지원하지 않습니다.
- `resolveSchedule`의 `useExhibitionHours`가 꺼져 있으면(기본값) 전시 운영 시간을 판정에 쓰지 않습니다.
  켜면 믿을 수 있는 요일만 씁니다(4장 참고). 해석기가 '모름'과 '휴관'을 구분하게 되면 켤 예정입니다.
  - 날짜별 일정(`scheduleForDate`)도 플래그가 켜져 있을 때만 적용됩니다.
  - `periods`의 요일이 `isOpen: false`인 것은 "N일부터 휴관"인지 원래 미기재인지 구분할 수 없어 "모름"으로 둡니다.
- 입장 마감이 없으면 폐관 시각을 입장 마감으로 봅니다. 실제 입장 마감이 폐관 30분 전인 곳은 폐관 직전 도착이 "가능"으로 나올 수 있습니다.
  화면은 `lastEntryAssumed`를 보고 "입장 마감 확인 필요" 같은 안내를 붙이는 것이 좋습니다.
  해석기가 읽지 못하는 표현(예: "17:30까지 입장가능")도 같은 경로로 폐관 기준이 됩니다.
- 회차 판단은 `note`의 `'회차'`(PR #41)에 기대고 있습니다. #41 전 데이터에는 이 note가 없어 회차 구간을 상시 관람 구간으로 읽습니다.
  #41에서 `sessions` 필드가 생기면 `isSessionDay`만 고치면 됩니다.
- 몇째 주는 1~7일 방식입니다. "첫째 주"를 달력의 첫 줄로 세는 시설이면 다르게 나옵니다.
- 구간이 여러 개인 날의 불가 사유는 가장 가까웠던 구간 하나의 것입니다. 다른 구간의 사유는 나오지 않습니다.
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
- `src/engine/scheduleForDate.ts`: 날짜별 일정 우선순위, 몇째 주 계산, 회차 판단(`isSessionDay`)
- `schema/`: JSON 스키마 (PR #28 병합 후)
- 팀 Notion의 'JSON 데이터 작성 가이드'
- `src/mock`: 목 데이터의 판정 문구
- `src/pages/Team.tsx`: 구조 설명
