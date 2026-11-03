# 데이터베이스 설계

## 1. 설계 목표

출시 예정 게임, 할인과 프로모션, 게임 대회,
게임 산업 이슈를 관리하는 관계형 DB를 설계한다.

DB는 PostgreSQL을 기준으로 한다.
첫 구현은 게임과 플랫폼별 출시 정보부터 시작한다.

## 2. 첫 구현의 테이블

### games — 게임 공통 정보

| 컬럼 | 자료형 | 설명 |
|---|---|---|
| id | bigint | 게임 고유 번호, 기본 키 |
| name | text | 게임 이름, 필수 |
| slug | text | 상세 페이지 주소용 이름, 필수·중복 불가 |
| description | text | 게임 소개 |
| official_url | text | 공식 홈페이지 주소 |
| image_url | text | 대표 이미지 주소 |
| created_at | timestamptz | 등록 시각 |
| updated_at | timestamptz | 수정 시각 |

### platforms — 실행 플랫폼

| 컬럼 | 자료형 | 설명 |
|---|---|---|
| id | bigint | 플랫폼 고유 번호, 기본 키 |
| name | text | PC, PS5 등 플랫폼 이름, 필수·중복 불가 |

Steam, Epic Games, Battle.net은 실행 플랫폼이 아닌
스토어이므로 이후 stores 테이블에서 관리한다.

### game_releases — 플랫폼별 출시 정보

| 컬럼 | 자료형 | 설명 |
|---|---|---|
| id | bigint | 출시 정보 고유 번호, 기본 키 |
| game_id | bigint | games.id를 참조하는 외래 키, 필수 |
| platform_id | bigint | platforms.id를 참조하는 외래 키, 필수 |
| region_code | text | 출시 지역, GLOBAL 또는 KR 등, 필수 |
| date_precision | text | day, month, quarter, year, unknown 중 하나 |
| release_year | smallint | 출시 연도 |
| release_month | smallint | 출시 월 |
| release_quarter | smallint | 출시 분기 |
| release_day | smallint | 출시 일 |
| schedule_status | text | confirmed, tentative, unknown 중 하나 |
| source_url | text | 공식 발표 등 정보 출처 |
| last_verified_at | timestamptz | 마지막 확인 시각 |
| created_at | timestamptz | 등록 시각 |
| updated_at | timestamptz | 수정 시각 |

## 3. 관계

- 게임 하나에는 여러 출시 정보가 연결된다.
- 플랫폼 하나에는 여러 게임의 출시 정보가 연결된다.
- 출시 정보 하나는 게임 하나와 플랫폼 하나를 참조한다.
- 게임·플랫폼·지역 조합은 중복 등록하지 않는다.
- 일정이 변경되면 해당 출시 정보를 수정한다.

기본 키는 각 행을 구별하는 고유 번호다.
외래 키는 다른 테이블의 행을 연결하는 번호다.

## 4. 출시 일정 저장 규칙

- day: 연도·월·일을 저장한다.
- month: 연도·월만 저장한다.
- quarter: 연도·분기만 저장한다.
- year: 연도만 저장한다.
- unknown: 연도·월·분기·일을 모두 비운다.
- 해당 정밀도에 필요하지 않은 날짜 항목은 비운다.
- 존재하지 않는 날짜는 등록할 수 없도록 검증한다.
- 날짜의 구체성과 일정 확정 여부는 별도로 관리한다.

예를 들어 “2027년 출시 예정”은 연도만 저장한다.
임의로 2027년 1월 1일로 저장하지 않는다.

## 5. 테스트 예시

아래 내용은 실제 게임 정보가 아닌 설명용 데이터다.

- games: 테스트 게임 A
- platforms: PC, PS5
- game_releases:
  - PC / GLOBAL / 2027년 / year / tentative
  - PS5 / GLOBAL / 일정 미정 / unknown / unknown

게임 이름과 소개는 한 번만 저장하고,
플랫폼별 출시 정보는 각각 저장한다.

## 6. 이후 확장

- 스토어 상품과 할인·프로모션
- 게임 대회와 개별 경기, 공식 중계
- 산업 이슈와 관련 게임
- 관리자 권한과 공개 상태 관리

위 영역도 첫 버전에 포함하며,
출시 정보의 저장·조회 흐름을 완성한 뒤 순서대로 구현한다.
