# 게임 정보 통합 웹서비스
여러 사이트에 흩어진 게임 정보를 한곳에서 확인할 수 있는
웹서비스를 개발합니다.

## 주요 기능

첫 버전에 다음 네 영역을 모두 포함합니다.

1. 출시 예정 게임
   - 게임 소개와 플랫폼별 출시 일정
   - 확정·미정 구분과 공식 발표 링크

2. 할인 및 프로모션
   - 스토어별 가격, 할인율, 종료일
   - 구매 페이지 연결

3. 게임 대회
   - 대회와 경기 일정, 진행 상태
   - 공식 중계 연결

4. 게임 산업 이슈
   - 개발 발표, 기업 동향, 정책 및 사회적 이슈
   - 핵심 내용과 원문 링크

## 이용 방식

- 일반 방문자는 로그인 없이 정보를 탐색합니다.
- 관리자는 정보를 등록하고 수정합니다.
- 정보의 출처와 최종 확인 시점을 표시합니다.

## 개발 현황

- [x] 서비스 기획
- [ ] DB 설계
- [ ] 개발 환경 구성
- [ ] DB 구축과 서버 연결
- [ ] 사용자 및 관리자 화면 구현
- [ ] 배포와 테스트

## 기술 구성

- 데이터베이스: PostgreSQL 기준으로 설계
- 프론트엔드, 서버 및 배포 환경: 추후 확정

## Steam 출시일 자동 갱신

1. 게임 프로젝트의 Supabase SQL Editor에서 `server/upcoming-game-recommendations.sql` 전체를 실행합니다.
2. Supabase 비밀 키를 서버의 `server/.env` 또는 배포 환경 변수에 `SUPABASE_RELEASE_SYNC_SECRET_KEY`로 설정합니다. 공개 키는 기존 `SUPABASE_PUBLISHABLE_KEY`에 유지합니다.
3. 서버를 재시작합니다. 서버 시작 직후와 실행 중 약 24시간마다 Steam을 조회합니다.

한국 Steam 스토어에서 정확한 날짜를 제공하는 미정 추천작의 Steam 일정만 업데이트합니다. 연도만 공개된 경우 기존 표시를 유지합니다. 갱신된 날짜는 홈페이지를 새로고침하면 표시됩니다.

## 할인·프로모션

Steam 목록을 읽는 데 필요한 패키지를 설치하려면 `server` 폴더에서
`npm.cmd install`을 실행한 후 `npm.cmd start`로 서버를 시작합니다.

홈페이지를 열거나 할인 영역의 새로고침 버튼을 누르면 최신 목록을 요청합니다.
페이지를 계속 열어 둔 경우에는 약 24시간마다 확인하며, 종료된 상품은 다음 확인 때 다른 유효한 할인으로 교체됩니다.

## 게임 뉴스

서버를 시작하면 인벤 RSS에서 최신 기사 10개를 가져오고, 실행 중에는 약 24시간마다 갱신합니다. 갱신에 실패하면 마지막으로 가져온 목록을 보여줍니다. 서버 시작 후 RSS 수집이 한 번도 성공하지 않은 경우 기존 Supabase 뉴스가 예비 목록으로 표시됩니다. 페이지를 열어둔 경우에도 약 24시간마다 목록을 다시 불러옵니다.

## 오늘의 e스포츠 경기

`server/.env` 또는 서버 배포 환경 변수에 `PANDASCORE_API_TOKEN`을 설정하면
한국 시간 기준 매일 자정에 오늘의 경기 일정을 갱신합니다. 서버 시작 시에도 그날 일정을 가져옵니다.
PandaScore에 등록된 CS2, 리그 오브 레전드, 배틀그라운드 일정을 사용하며 제공되는 공식
YouTube 영상이나 Twitch 채널은 카드 안에서 재생할 수 있습니다.
해당 경기 일정이 없거나 수집할 수 없으면 Supabase 추천 대회 목록을 표시합니다.

## 회원 로그인 설정

1. Supabase SQL Editor에서 `server/game-auth.sql`을 실행합니다. 인증 데이터는 별도 스키마 `game_auth`에 보관합니다. Supabase Data API의 노출 스키마에는 추가하지 않습니다.
2. `server/.env`에 아래 환경 변수를 설정합니다. AUTH_DATABASE_URL은 위 스키마에 접근 가능한 PostgreSQL 직접 연결 문자열입니다. Supabase Connect의 Direct connection을 사용하고 비밀번호의 특수문자는 URL 인코딩합니다. 원격 DB는 TLS를 사용합니다.
3. Google Cloud의 웹 애플리케이션 OAuth 클라이언트와 네이버 개발자센터의 웹 애플리케이션에 각각 아래 콜백 주소를 등록합니다. 네이버 서비스 URL은 `http://localhost:5173`이며 회원 이메일을 제공 항목에 포함합니다.
4. `server`에서 `npm.cmd install`, `npm.cmd start`를 실행하고 `client`에서 `npm.cmd install`, `npm.cmd run dev`를 실행합니다. 브라우저에서 `http://localhost:5173`을 엽니다. 배포 시 사이트와 /api를 동일 출처로 제공하고 URL과 콜백을 실제 HTTPS 주소로 변경합니다.

```dotenv
BETTER_AUTH_URL=http://localhost:5173
BETTER_AUTH_SECRET=<32바이트 이상의 임의 비밀값>
AUTH_DATABASE_URL=<PostgreSQL 연결 문자열>
GOOGLE_CLIENT_ID=<구글 클라이언트 ID>
GOOGLE_CLIENT_SECRET=<구글 클라이언트 시크릿>
NAVER_CLIENT_ID=<네이버 클라이언트 ID>
NAVER_CLIENT_SECRET=<네이버 클라이언트 시크릿>
```

비밀값은 로컬에서 `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`로 생성합니다.

- 구글 콜백은 `http://localhost:5173/api/auth/callback/google`입니다.
- 네이버 콜백은 `http://localhost:5173/api/auth/callback/naver`입니다.
- 자체 가입은 이메일·비밀번호·닉네임을 사용합니다. 현재 이메일 소유 확인 메일은 발송하지 않으며 동일 이메일을 근거로 다른 로그인 수단을 자동 연결하지 않습니다.
- 현재 회원은 `GET /api/auth/get-session`에서 확인합니다. 이후 개인화 API에서도 서버가 세션의 사용자 ID를 확인해야 합니다.
