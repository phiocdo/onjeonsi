# schema

JSON 데이터 파일의 형식을 정의한 JSON Schema(draft-07) 파일입니다.
작성법은 팀 Notion의 "JSON 데이터 작성 가이드"를 참고하세요.

## 확정

| 파일 | 대상 |
|---|---|
| `exhibitions.schema.json` | `data/exhibitions/auto.json` (수집 스크립트가 만드는 전시 목록) |
| `holidays.schema.json` | `data/holidays/holidays.json` (공휴일 `YYYY-MM-DD` 배열) |

## 추가 예정

- `venue.schema.json`: 시설 JSON. PR #21에서 파일 형식(한 파일 / 시설마다 한 파일)을 정한 뒤 추가합니다.
- 제안 5개(`judge-scenarios`, `personal-records-export`, `shared-reviews-seed`, `categories`, `popular-venues`): 11/19 타입 합의 뒤 추가합니다.
- PR #22의 `operatingHours`, `imageUrl`, `detailUrl`: PR #22가 병합될 때 exhibitions 스키마에 추가합니다.

## 스키마로 잡지 못하는 것

- id 중복, 날짜 오름차순, 시작일이 종료일보다 이른지는 검사하지 못합니다.
- 없는 날짜(예: `2026-02-30`)도 형식만 맞으면 통과합니다.
- 모르는 키는 허용하므로 그 값은 검사하지 않습니다.

## 알려진 차이

- 스키마는 선택 필드에 `null`을 허용하지만 `src/types`의 `Exhibition`은 허용하지 않습니다.
  지금 `auto.json`에 `lat: null`이 있어서 허용해 두었고, 수집 스크립트가 잘못된 좌표를 빼도록 고쳐지면 `null` 허용을 없앱니다.
