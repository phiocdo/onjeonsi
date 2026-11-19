# schema

JSON 데이터 파일의 형식을 정의한 JSON Schema(draft-07) 파일입니다.
작성법은 팀 Notion의 "JSON 데이터 작성 가이드"를 참고하세요.

## 확정

| 파일 | 대상 |
|---|---|
| `exhibitions.schema.json` | `data/exhibitions/auto.json` (수집 스크립트가 만드는 전시 목록) |
| `holidays.schema.json` | `data/holidays/holidays.json` (공휴일 `YYYY-MM-DD` 배열) |
| `venue.schema.json` | `data/venues/*.json` (시설마다 파일 하나. 파일 이름과 `id`가 같은지는 `validate-data.ts`가 따로 검사) |

위 세 가지는 `npm run validate`와 배포 워크플로가 검사합니다. 시설 파일은 수집하지 않는 값이라,
스키마에 어긋나면 배포가 멈춥니다.

## 추가 예정

- 제안 스키마 5개(`judge-scenarios`, `personal-records-export`, `shared-reviews-seed`, `popular-venues`, `venue-links`):
  파일은 PR #33으로 들어왔고, 타입이 확정되면 검사에 추가합니다.

## 제안 스키마 메모

- `judge-scenarios`: 정답 근거 필드는 `evidence`입니다(`JudgeResult.basis`와 이름이 겹치지 않도록 `basis`에서 바꿈).
  `expectedReasons`는 `REASONS` 키로 적고, `NOT_IMPLEMENTED`·`MISSING_VENUE`는 쓰지 않습니다(시나리오는 실제 시설을 전제로 함).
  `INVALID_INPUT`은 `unknown`일 때만, 다른 사유 없이 혼자 씁니다.
- `venue-links`(`data/venue-links.json`): `matchVenue`가 이름·좌표로 연결하지 못하거나 틀리게 연결할 때만
  `placeName` 원문을 키로 `venueId`(연결하지 않을 곳은 `null`)를 적습니다. 이미 올바르게 연결되는 곳은 적지 않습니다.

## 스키마로 잡지 못하는 것

- id 중복, 날짜 오름차순, 시작일이 종료일보다 이른지는 검사하지 못합니다.
- 운영시간 구간의 `open`이 `close`보다 이른지도 검사하지 못합니다.
- 없는 날짜(예: `2026-02-30`)도 형식만 맞으면 통과합니다.
- 전시 파일 최상위의 모르는 키는 허용하므로 그 값은 검사하지 않습니다(수집 필드가 늘어도 배포가 멈추지 않게).
  해석기가 만드는 `operatingHours` 안쪽은 정해진 키만 허용합니다.

## 알려진 차이

- 스키마는 선택 필드에 `null`을 허용하지만 `src/types`의 `Exhibition`은 허용하지 않습니다.
  지금 `auto.json`에 `lat: null`이 있어서 허용해 두었고, 수집 스크립트가 잘못된 좌표를 빼도록 고쳐지면 `null` 허용을 없앱니다.
