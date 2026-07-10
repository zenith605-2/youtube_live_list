# 유튜브 실시간 CCTV 모음

유튜브 라이브 중인 CCTV 영상을 키워드 검색으로 자동 수집해 보여주는 커뮤니티 사이트입니다.
매일 `scripts/update.mjs`가 실행되어 중지된 스트림/오탐을 제거하고 신규 스트림을 추가합니다.
Google 계정으로 로그인하면 새 CCTV 주소를 직접 제보하거나, 오탐 영상을 신고할 수 있습니다
(같은 영상이 10명 이상에게 신고당하면 자동으로 목록에서 내려갑니다).

## 구조
- `index.html`, `css/`, `js/app.js` — 정적 프론트엔드 (Supabase에서 목록/로그인/제보/신고 처리)
- `sql/schema.sql` — Supabase에 적용할 테이블/보안정책/트리거
- `scripts/migrate-seed.mjs` — (1회용) 기존 `data/streams.json`을 Supabase로 이관
- `config/keywords.json` — 검색에 사용할 키워드 목록
- `config/exclude-keywords.json` — 제목/채널명에 포함되면 걸러내는 제외 키워드 (뉴스/방송 채널 오탐 방지)
- `scripts/update.mjs` — YouTube Data API + Supabase로 목록을 갱신하는 Node.js 스크립트
- `.github/workflows/update.yml` — 매일 자동 실행 워크플로

## 1. YouTube Data API 키 발급
1. https://console.cloud.google.com 접속 후 새 프로젝트 생성(또는 기존 프로젝트 사용)
2. 좌측 메뉴 "API 및 서비스" → "라이브러리" → "YouTube Data API v3" 검색 → 사용 설정
3. "API 및 서비스" → "사용자 인증 정보" → "사용자 인증 정보 만들기" → "API 키" 선택 → 복사

무료 할당량은 1일 10,000 unit이며, 본 스크립트는 키워드 15개 기준 약 1,500~2,000 unit을 사용합니다.

## 2. Supabase 프로젝트 생성
1. https://supabase.com 접속 → 무료 계정 생성 → New Project
2. 프로젝트 생성 후 좌측 "Project Settings" → "API"에서 **Project URL**, **anon public key**, **service_role key** 확인
   - `anon public key`는 공개되어도 안전한 키입니다 (RLS로 보호됨)
   - `service_role key`는 절대 브라우저/프론트엔드 코드에 넣지 마세요 (GitHub secret에만 사용)
3. 좌측 "SQL Editor" → 이 저장소의 `sql/schema.sql` 내용 전체 복사해서 붙여넣고 **Run**

## 3. Google 로그인 연동 (Supabase Auth)
1. Google Cloud Console(1번에서 쓴 프로젝트 재사용 가능) → "API 및 서비스" → "사용자 인증 정보" → "사용자 인증 정보 만들기" → **OAuth 클라이언트 ID**
2. 애플리케이션 유형: "웹 애플리케이션"
3. Supabase 대시보드 → "Authentication" → "Providers" → "Google"을 열면 표시되는 **콜백(Redirect) URL**을 복사해서, Google Cloud Console의 "승인된 리디렉션 URI"에 붙여넣기
4. 발급된 **클라이언트 ID / 클라이언트 보안 비밀번호**를 Supabase의 Google Provider 설정 화면에 입력하고 저장, 토글을 켜서 활성화

## 4. 프론트엔드에 Supabase 연결
`js/app.js` 상단의 아래 두 값을 실제 값으로 교체:
```js
const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```

## 5. 기존 데이터 이관 (1회)
```bash
cd cctv-live-list
npm install
SUPABASE_URL=프로젝트URL SUPABASE_SERVICE_ROLE_KEY=서비스롤키 node scripts/migrate-seed.mjs
```
Windows PowerShell:
```powershell
$env:SUPABASE_URL="프로젝트URL"; $env:SUPABASE_SERVICE_ROLE_KEY="서비스롤키"; node scripts/migrate-seed.mjs
```

## 6. 로컬에서 갱신 스크립트 테스트
```powershell
$env:YOUTUBE_API_KEY="유튜브키"; $env:SUPABASE_URL="프로젝트URL"; $env:SUPABASE_SERVICE_ROLE_KEY="서비스롤키"; node scripts/update.mjs
```

## 7. GitHub에 배포 (자동 갱신 + 무료 호스팅)
1. GitHub에 새 저장소 생성 후 이 폴더를 push
2. 저장소 Settings → Secrets and variables → Actions → New repository secret 로 아래 3개 등록
   - `YOUTUBE_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Settings → Pages → Source를 `main` 브랜치 `/ (root)`로 설정 → 배포된 URL 확인
4. Actions 탭에서 "Update CCTV live list" 워크플로가 매일 KST 06:00에 자동 실행됩니다.
   (Actions 탭 → 워크플로 선택 → "Run workflow"로 즉시 수동 실행도 가능)

## 키워드 커스터마이즈
`config/keywords.json`의 `keywords` 배열에 검색어를 추가하면 다음 실행부터 반영됩니다.

## 오탐(false positive) 제외
"CCTV"는 감시카메라 외에 중국 CCTV(중국중앙방송, China Central Television) 같은 방송사 이름과도 겹쳐서,
뉴스/드라마 채널이 섞여 들어올 수 있습니다. `config/exclude-keywords.json`에 제목/채널명 키워드를 추가하면
다음 실행부터 기존 목록에서도 자동으로 걸러집니다. 로그인한 유저가 직접 "오탐 신고" 버튼으로 신고할 수도
있고, 같은 영상이 10명 이상 신고하면 즉시(DB 트리거) 목록에서 삭제됩니다.

## 유저 제보
로그인한 유저는 상단 입력창에 유튜브 라이브 URL을 붙여넣어 새 CCTV를 등록할 수 있습니다.
등록 즉시 목록에는 나타나지만 제목/채널명은 다음날 `update.mjs`가 실행될 때 정식으로 채워지며,
실제로 라이브 중이 아니면 그때 자동으로 삭제됩니다.

## 기여도 점수 / 랭킹
다른 유저가 내가 제보한 카드에서 "👍 추천"을 누르면 점수가 올라갑니다(본인 제보는 추천 불가, 1인당 1회).
상단 "🏆 기여도 랭킹" 버튼을 누르면 추천을 많이 받은 순으로 정렬된 순위표를 볼 수 있습니다.
