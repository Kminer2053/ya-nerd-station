<div align="center">

# 야!너두 스테이션 편집기

### VWorld 실내 3D 지도 위에 변경 레이어를 관리하는 공개 편집기

원본 3D 모델은 건드리지 않고, 현장에서 바뀐 부분만 덧씌웁니다

<br/>

![VWorld](https://img.shields.io/badge/공간원본-VWorld%203D%20Tiles-0A5EB0)
![CesiumJS](https://img.shields.io/badge/렌더러-CesiumJS%201.142-3F4F75)
![D1](https://img.shields.io/badge/DB-Cloudflare%20D1-F38020)
![R2](https://img.shields.io/badge/업로드-Cloudflare%20R2-F38020)
![역](https://img.shields.io/badge/실내지도-46개%20KTX역%20연결-D4A843)
![MIT](https://img.shields.io/badge/license-MIT-green)

**[공개 제보](https://toolkit.yanerdstation.kr)** · **[제보함](https://toolkit.yanerdstation.kr/console/)** · **[편집기](https://toolkit.yanerdstation.kr/editor/)** · **[프로젝트 소개](https://yanerdstation.kr)** · **[서울역 프로토타입](https://seoul.yanerdstation.kr/seoul)**

</div>

---

## 왜 이 도구인가

| 기존 방식 | 이 편집기 |
|---|---|
| 원본 3D 모델을 직접 수정 · 수정 이력 소실 | 원본 유지 + 변경 레이어 분리 · revision 추적 |
| 역마다 전용 도구 · 재사용 불가 | 46개 KTX역에 동일 스키마·동일 UI |
| 현장 변화는 관리자가 직접 찾아야 함 | 누구나 사진으로 제보 · 승인자가 보정·승인해 반영 |
| 데이터(시설·유동·매출) 별도 관리 | 구조물→파사드→포인트→경로→데이터 한 화면 |
| AI 연동 없음 | WebMCP로 읽기·편집·저장·제안 도구 노출 |

[야!너두 스테이션](https://yanerdstation.kr) 프로젝트의 구축 도구이며, **Station One** 시리즈 프로토타입(서울역·대전역)의 편집 데이터를 열람하고 나머지 44개 역의 편집을 시작할 수 있습니다.

---

## 두 갈래 구조 — 누구나 제보·열람, 승인자가 처리

| 주소 | 사용자 | 하는 일 |
|---|---|---|
| `/` | 누구나 (로그인 없이) | 46개 KTX역 3D 지도 탐색, 현장과 다른 곳을 눌러 사진 제보, 내 제보 진행 확인 |
| `/console/` | 누구나 열람 · 승인자만 처리 | 제보함: 진행 단계별 현황과 흐린 공개용 사진을 누구나 봅니다. 승인자(이름·비밀번호 로그인)만 사진 원본 확인, 파사드 정면 보정 → 제안 → 승인, 보류·중복·반려를 합니다 |
| `/editor/` | 앰배서더 | 구조물·파사드·시설·경로 직접 편집 (아래 9가지 편집 작업) |

### 제보에서 반영까지

1. **탐색** — 역과 층을 골라 3D 지도를 둘러봅니다.
2. **제보** — 지도에서 위치를 누른 뒤 한 화면에서 유형(매장·간판 변경, 새로 생김, 없어짐, 길 막힘, 안내 정보 오류, 기타)을 고르고 사진 1~5장을 올립니다. 사진을 보면서 달라진 곳을 눌러 표시하고 사진마다 설명을 붙일 수 있습니다. 사진은 브라우저에서 2048px JPEG로 다시 만들어 EXIF·GPS를 지우고, 공개 제보함용으로 48px 모자이크를 따로 만듭니다.
3. **정리** — 규칙: 12m 안의 파사드 자리·시설 매칭(시선 방향 반영), 8m·14일 안의 같은 곳 제보 묶음. AI 키가 있으면 간판 글자, 등록 매장과 같은지, 매장면 네 모서리, 사람 위치를 함께 읽습니다. 정리는 지도를 바꾸지 않습니다.
4. **보정·제안** — 승인자가 매장면 네 모서리를 맞추면 호모그래피로 파사드 규격 픽셀(예: 175×176)에 정확히 옮겨 붙이고, 자동 밝기와 사람 모자이크를 적용합니다. 새 그림을 생성하지 않습니다. 서울역은 3D 지도의 실제 자리에 미리 입혀 볼 수 있습니다.
5. **승인** — 승인자가 승인해야 반영됩니다. 같은 곳 제보도 함께 처리되고 제보자는 “내 제보”에서 결과와 사유를 봅니다. 서울역은 심사 기간 동안 승인해도 **반영 대기**로 남고, 다른 역은 바로 반영되어 3D 지도의 해당 벽면에 새 파사드가 그려집니다.

진행 단계는 **접수 → 자동 정리 → 승인자 검토 → 보정 제안 → 승인 → 지도 반영**이며, 보류는 그 자리에서 멈추고 중복·반려는 종료로 표시합니다. 제보함 위쪽 단계 막대에서 단계별 건수를 보고 눌러서 걸러 볼 수 있습니다.

1단계는 파사드 교체 제안까지 자동화합니다. 새 구조물·철거·경로 변경은 제보함에서 판단을 남기고 편집기에서 처리합니다.

---

## 46개 KTX역 — VWorld 실내지도 연결

46개 역 모두 3D 지도에 연결되어 있습니다. 역 ID·공식 이름·중심 좌표·층별 높이는 VWorld 웹 지도가 쓰는 실내 목록(`map.vworld.kr/dtkmap/indoorServices.do`)에서 역 이름으로 찾은 값이며, 이름이 정확히 일치(`○○역KTX`)하고 CDN 타일셋이 있으며 중심이 그 안에 들어올 때만 연결했습니다. 서울역(`S202103`)·대전역(`S201801`)은 같은 방법으로 대조해 기존 값과 일치했습니다.

- 조회·검증: `node tools/discover-vworld-sites.mjs` (한 번에 한 건, 1.5초 간격, 재시도 없음) → 근거 `data/vworld-sites.json`, 역 설정 `src/vworld-stations.js`
- 특정 역만 확인: `node tools/discover-vworld-sites.mjs 부산역 울산역` (파일을 쓰지 않음)
- 이 실내 목록은 공식 OpenAPI가 아니고 이용약관이 키별 호출량을 제한하므로, 역 목록이 바뀔 때만 실행합니다. 외부 정식 서비스 전에는 VWorld 인증키·도메인 등록이 필요합니다.
- 연결 전에 받은 제보의 `name:<역명>` 키는 연결된 역으로 그대로 이어집니다.
- 시설 후보는 아직 대전역만 등록되어 있습니다. 다른 역은 3D 탐색·제보·보정·승인은 되지만, 매장 자리(파사드 슬롯)는 역별 텍스처 검토를 거쳐 추가합니다.

### 대전역 시설 후보

대전역은 VWorld 3D 타일 텍스처(객체 244개, 텍스처 슬롯 1,379개)를 눈으로 검토해 매장 전면 40곳(간판을 읽은 19곳 포함), 안내·편의시설 22곳, 에스컬레이터 13곳, 방향 안내표지 24곳을 후보로 등록했습니다. 이름은 텍스처 사진 속 간판을 읽은 것이며 현장 확인 전이고, 읽지 못한 간판은 `3F 매장 후보 (슬롯)`처럼 이름을 붙이지 않았습니다. 공개 지도와 편집기 초안에 시설로 나오고, 매장 전면은 파사드 제안의 규격 슬롯이 됩니다.

- 검토 기록: `data/daejeon-candidates.review.json` (슬롯·근거·확실도)
- 생성: `node tools/build-daejeon-candidates.mjs [object-texture-slots.json]` → `src/daejeon-candidates.js`
- VWorld 원본 텍스처 이미지는 저장소와 배포본에 넣지 않습니다.

---

## 편집 작업 9가지

| 탭 | 키 | 설명 |
|---|---|---|
| **구조물** | `assets` | 추가·좌표·크기·회전·색상 편집 · 기본지도 에셋 ID로 원본 숨김 |
| **파사드** | `facades` | 정면·우측·후면·좌측 면별 PNG/JPEG 등록 · 업로드 or URL |
| **현장변경** | `changes` | 추가·이동·숨김·철거 설정 JSON · 원본 렌더러 구성 열람 |
| **시설정보** | `facilities` | 매장·편의시설 등록·해제 이력 · 영업시간·연락처·보행점 연결 |
| **발생원점** | `origins` | 외부 유동인구 원점 · 교통수단 모드 · 실내 출도착점 연결 |
| **시설·포인트** | `points` | 출발/도착(영역 지정 가능)·경유·층간접속·시설 4가지 역할 |
| **층간연결** | `connections` | 계단·에스컬레이터·엘리베이터 · 양방향/단방향 · N:N 층 |
| **이동동선** | `routes` | 포인트 순서 기반 경로 · 층 전환 시 유효한 층간연결 검증 |
| **연계 데이터** | `observations` | 일별·시간별 진입/이탈량 · 관측/추정 구분 · 산출 근거 기재 |

모든 탭에서 등록 항목은 이름·ID·층·역할로 검색할 수 있고, 지도 클릭으로 좌표가 자동 입력됩니다. 대전역 새 초안은 시설 후보 99곳을 시설·포인트로 품고 시작합니다.

---

## Station One 서울역 연동

서울역은 **revision 334 확정본**을 읽기 전용 API로 불러옵니다.

| 항목 | 수량 |
|---|---|
| 유동인구 원점 | 53개 (활성 48) |
| 출도착점 | 8곳 |
| 등록 시설 | 281건 (활성 115) |
| 승인 파사드 | 94건 |
| 현장 변경 | 21건 |
| 층간연결 | 84개 |
| 이동동선 | 28개 |
| 일별 관측 | 1,488건 |

심사 기간 서버 저장·업로드는 **UI와 서버 양쪽에서 차단**됩니다. 임시 편집과 JSON 내보내기는 허용합니다.

서울역 선택 시 편집기는 본체(Station One)의 최신 파사드·시설을 `<iframe>` postMessage로 실시간 반영하므로, 편집기 자체 CesiumJS 인스턴스가 아닌 본체 렌더러에서 서울역을 표시합니다. 제보함의 “3D에 미리 입히기”도 같은 연결로 보정 결과를 실제 파사드 자리에 저장 없이 보여 줍니다.

---

## 디렉터리 구조

```
ya-nerd-station-editor/
├── index.html                  공개 제보 (역 탐색 · 사진 제보 · 내 제보)
├── console/index.html          제보함 (공개 열람 · 승인자 처리)
├── editor/index.html           편집기 (9가지 편집 작업)
├── package.json · vite.config.js · drizzle.config.ts · LICENSE
├── src/
│   ├── main.js                 편집기: 탭·목록·폼·저장·불러오기·공유·WebMCP
│   ├── model.js                프로젝트 스키마·검증·샘플·역별 초안(대전역 후보 포함)
│   ├── scene.js                이중 렌더: 서울=iframe postMessage / 그 외=CesiumJS 네이티브(VWorld 직접 로딩)
│   ├── seoul-snapshot.js       서울 스냅샷 API → 편집기 프로젝트 스키마 변환
│   ├── stations.js             서울·대전 + VWorld 목록으로 확인한 44개 역 · 유효성 검증
│   ├── vworld-stations.js      (생성) 44개 역 ID·중심·층 높이
│   ├── daejeon-candidates.js   (생성) 대전역 시설 후보·파사드 슬롯
│   ├── reports.js              제보 유형·상태·진행 단계·입력 검증·매칭 (브라우저·서버 공용)
│   ├── rectify.js              정면 보정: 호모그래피·샘플링·자동 밝기·모자이크
│   ├── progress.js/.css        진행 단계 표시
│   ├── public/                 공개 제보 화면
│   ├── console/                제보함 화면
│   └── style.css               편집기 스타일
├── server/
│   ├── index.js                Workers fetch 핸들러: 프로젝트·파일·서울 스냅샷·지도 중계
│   ├── reports.js              제보·공개 조회·제보함·승인자 로그인·제안·승인·가져오기
│   └── ai.js                   선택 AI 정리 (엄격한 결과 검증, 실패 시 규칙 정리)
├── db/schema.ts                drizzle-orm D1 스키마
├── drizzle/                    0000 편집 프로젝트 · 0001 제보 · 0002 승인자·사진 설명
├── data/                       대전역 후보 검토 기록 · VWorld 역 조회 근거
├── tools/
│   ├── test.mjs · test-seoul.mjs · test-reports.mjs
│   ├── local-api.mjs · local-scene.mjs     개발 서버 플러그인 (로컬 SQLite·업로드, 대전역 로컬 타일)
│   ├── discover-vworld-sites.mjs           VWorld 실내 목록으로 역 확인
│   ├── build-daejeon-candidates.mjs        대전역 후보 생성
│   └── import-facades.mjs                  다른 곳에서 승인된 파사드 가져오기
├── public/favicon.svg
├── data-private/               로컬 SQLite DB · 업로드 · 로컬 승인자 계정 (gitignore)
└── .openai/hosting.json        ChatGPT Sites 호스팅 설정 (D1 `DB`, R2 `UPLOADS`)
```

---

## 실행

```bash
npm ci
npm run dev           # http://127.0.0.1:4197/ (공개 제보) · /console/ · /editor/
npm run build         # dist/ 생성 (정적 클라이언트 + esbuild Worker)
```

`npm run dev`는 로컬 API(SQLite `data-private/editor.sqlite`와 업로드 폴더, 마이그레이션 자동 적용)와 대전역 로컬 타일(`/local-tiles`)을 함께 띄웁니다. 로컬 미리보기의 승인자 계정은 처음 실행할 때 `data-private/local-approvers.txt`에 무작위 비밀번호로 만들어집니다. 서울역 3D를 보려면 Station One 서비스 개발 서버가 `http://127.0.0.1:4196`에서 떠 있어야 하고, 편집기는 반드시 4197 포트여야 합니다(서비스 연결 허용 출처).

Node.js 22.13 이상이 필요합니다. VWorld 3D Tiles를 사용하므로 인터넷 연결이 필요합니다.

---

## 테스트

```bash
npm test                    # 메모리 저장소 CRUD · 프로젝트 검증 · 충돌 감지
node tools/test-seoul.mjs   # 서울 스냅샷 어댑터 변환 검증
npm run test:reports        # 제보·공개 제보함·승인자 로그인·제안·승인·대전역·가져오기·정면 보정 계산
```

`test.mjs`는 서버 없이 `model.js`의 `validateProject`·`sampleProject`를 직접 검증합니다:
- 스키마 버전 1 필수
- 역 ID 형식 `/^S\d{6}$/` · 좌표 범위 124~132°E / 33~39°N
- 층 코드 `/^(B[1-9]\d?|[1-9]\d?F|RF)$/` · 고도 유한수
- 전체 프로젝트 ID 고유성
- 층간연결은 서로 다른 층의 접속점 2개 이상
- 경로의 층간 이동에 유효한 층간연결 필수
- 추정값에 산출 근거 (`method`) 필수
- 파사드 URL은 `https://` · `http://localhost:` · `/api/files/` · `data:image/` 만 허용

---

## 설정 (Worker 환경 변수)

| 이름 | 필수 | 설명 |
|---|---|---|
| `APPROVERS` | 예 | 승인자 계정 `이름:비밀번호`를 쉼표나 줄바꿈으로 구분 (비밀번호 8자 이상, Worker 비밀 값으로 등록). 없으면 제보함은 읽기 전용 |
| `AI_API_KEY` | 아니요 | 설정하면 제보 사진을 비전 모델로 정리. 없으면 규칙 정리만 |
| `AI_PROVIDER` | 아니요 | `anthropic`(기본) 또는 `openai` |
| `AI_MODEL` | 아니요 | 기본 `claude-sonnet-5`. `openai`는 필수 |
| `REPORT_STORAGE_MB` | 아니요 | 제보 사진 전체 저장 한도, 기본 500 |

배포 전에 D1에 `drizzle/0001_public_reports.sql`, `drizzle/0002_approvers_photo_notes.sql` 마이그레이션을 적용하세요.

---

## API 엔드포인트

### 서울역 읽기 전용 (프록시)

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/seoul/snapshot` | GET | revision 334 확정 설정 전체 (원점·시설·파사드·경로·데이터) |
| `/api/seoul/hourly?origin=ID` | GET | 원점별 시간대 유동 데이터 JSON |

쓰기 요청 시 `423 Locked` 반환.

### VWorld 타일 중계 (예비 경로)

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/map-source/:stationId/tileset.json` | GET | VWorld 3D Tiles 메타데이터 |
| `/api/map-source/:stationId/:tile.b3dm` | GET | VWorld B3DM 타일 바이너리 |

역 ID 형식 `S\d{6}` · 5분 캐시 · HEAD 지원. VWorld CDN 장애 시 `503`. 브라우저는 먼저 `cdn.vworld.kr`에서 직접 받고, 15초 안에 응답이 없을 때만 이 경로를 씁니다.

### 프로젝트 CRUD

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/projects` | GET | 이 브라우저의 프로젝트 목록 (쿠키 기반) |
| `/api/projects` | POST | 새 프로젝트 생성 (브라우저당 30개 · 전체 200개) |
| `/api/projects/:id` | GET | 프로젝트 조회 (본인 or 공개) |
| `/api/projects/:id` | PUT | 프로젝트 수정 (revision 충돌 시 `409`) |

### 파일 업로드

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/projects/:id/files` | POST | 파사드 이미지 업로드 (PNG/JPEG · 4MB · 프로젝트당 100장) |
| `/api/files/:fileId` | GET | 업로드 이미지 서빙 (R2) |

### 공개 조회 (쿠키 없음 · `Access-Control-Allow-Origin: *`)

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/public/stations` | GET | 46개 역과 역별 검토 중·승인 건수 |
| `/api/public/station?key=` | GET | 역 설정·시설·출도착점·승인된 변경·반영된 파사드(`overlays`) |
| `/api/public/proposal-images/:id` | GET | 승인된 파사드 이미지 (반영 대기·반영만) |
| `/api/public/report-previews/:photoId` | GET | 제보 사진의 48px 모자이크 |

### 제보 (기기 쿠키 `nerd-reporter`)

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/reports` | POST | 제보 만들기 (하루 10건) |
| `/api/reports/:id/photos` | POST | 사진 올리기 (PNG/JPEG · 4MB · 5장 · 1시간 안) |
| `/api/reports/:id/submit` | POST | 사진별 설명·표시·모자이크와 함께 제출 → 자동 정리 |
| `/api/reports/mine` | GET | 내 제보와 진행 단계 |
| `/api/reports/photos/:id` | GET | 사진 원본 (제보자·승인자만) |

### 제보함 (읽기는 누구나 · 처리는 승인자 세션 `nerd-approver`)

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/session` | GET | 로그인 사용자·승인자 여부 |
| `/api/console/login` · `/logout` | POST | 승인자 이름·비밀번호 로그인 (주소별 15분 5회 실패 제한, 8시간 세션) |
| `/api/console/reports?stage=&station=` | GET | 진행 단계별 목록과 단계별 건수 |
| `/api/console/reports/:id` | GET | 제보 상세 (공개: 모자이크, 승인자: 원본) |
| `/api/console/reports/:id/decision` · `/analyze` | POST | 보류·중복·반려·다시 검토 (사유 필수) · 다시 정리 — 승인자 |
| `/api/console/station?key=` | GET | 역의 파사드 슬롯 |
| `/api/console/proposals` | POST | 정면 보정 결과로 파사드 제안 (슬롯 규격 픽셀 일치) — 승인자 |
| `/api/console/proposals/:id/approve` · `/reject` | POST | 승인(서울역은 반영 대기) · 반려(사유 필수) — 승인자 |
| `/api/console/import-facade` | POST | 다른 곳에서 승인된 파사드 가져오기 (출처 ID로 중복 방지) — 승인자 |

---

## 데이터 모델

### D1 테이블

| 테이블 | 내용 |
|---|---|
| `editor_projects` · `editor_files` | 편집 프로젝트(JSON)와 업로드 파일 메타데이터 (0000) |
| `reports` · `report_photos` | 제보와 사진(설명·표시 위치·모자이크 크기) (0001·0002) |
| `proposals` | 파사드 제안·승인 상태·출처 (0001) |
| `station_layers` | 역별 반영된 변경 레이어(파사드 오버레이) (0001) |
| `audit_log` | 판단·제안·승인·로그인 기록 (0001·0002) |
| `approver_sessions` | 승인자 세션 토큰 해시 (0002) |

사진·제안 이미지는 R2 `UPLOADS`에 `report/`, `report-preview/`, `proposal/` 접두어로 저장합니다.

### 프로젝트 JSON 구조 (`body`)

```
{
  schema_version: 1,
  site_id: "S201801",            // 역 ID
  name, source, tileset_url,
  station: { id, name, centre, floors, heights, default_floor },
  assets:       [{ id, name, floor, position, size, heading, color, hidden, facades, source_id }],
  points:       [{ id, name, floor, position, role, area?, origin_ids? }],
  connections:  [{ id, name, kind, point_ids, direction, path? }],
  routes:       [{ id, name, point_ids }],
  observations: [{ id, origin_id, date, hour, arrivals, departures, value_class, method }],
  origins:      [{ id, name, mode, notes, active }],
  facilities:   [{ id, name, floor, position, category, hours, contact, notes, active }],
  changes:      [{ id, name, config }]
}
```

---

## 지도와 저장소

- **3D 지도**: 브라우저가 VWorld CDN(`cdn.vworld.kr`, 모든 출처 허용)에서 직접 받고, 15초 안에 응답이 없을 때만 이 사이트의 중계를 씁니다. 지도 트래픽이 Worker 요청 한도를 쓰지 않도록 하기 위해서입니다.
- **저장소**: 제보·제안·승인·역별 변경 레이어는 이 사이트의 D1/R2(Sites 제공)에 저장합니다. Supabase는 쓰지 않습니다. 공개 조회와 승인 이미지는 다른 사이트(Station One 서비스의 대전역 지도)가 읽을 수 있게 엽니다.
- **다른 곳에서 승인된 파사드 가져오기**: `node tools/import-facades.mjs <manifest 폴더> [사이트 주소]` (승인자 계정 필요, 같은 출처는 한 번만 들어감). manifest는 서비스의 `tools/export-supabase-facades.mjs`가 만듭니다.

---

## 보안 모델

| 항목 | 구현 |
|---|---|
| 편집 권한 | HttpOnly 쿠키 (`nerd-owner`) · UUID → SHA-256 해시 비교 |
| 승인자 | `APPROVERS` 이름·비밀번호 · HttpOnly `SameSite=Strict` 세션 8시간 · 토큰 해시만 저장 · 로그아웃 시 삭제 |
| 로그인 보호 | 주소별 15분 5회 실패 시 잠금 · 비밀번호 비교는 같은 길이 해시로 |
| CSRF | 요청 Origin ≠ 사이트 Origin → `403` |
| 서울역 잠금 | `saveLocked()` → UI 비활성 + 서버 `423 Locked` 이중 차단 · 제보 승인은 반영 대기 |
| 업로드 검증 | 매직 바이트(PNG `89504E47` / JPEG `FFD8FF`) · 4MB · 프로젝트당 100장 · 제보당 5장 |
| 제보 사진 | 원본은 제보자·승인자만 · 공개 화면은 48px 모자이크 · 반려 제보는 내용·사진을 가리고 사유만 공개 |
| 제보 한도 | 기기당 하루 10건 · 전체 2만 건 · 사진 합계 `REPORT_STORAGE_MB` |
| 저장 한도 | 브라우저당 30프로젝트 · 전체 200 · body 합계 64MB · 파일 합계 100MB |
| 공개 링크 | `shared=1`이면 GET 허용 · 쓰기 차단 · "복사 후 편집" |
| 기록 | 판단·제안·승인·가져오기·로그인은 `audit_log`에 승인자 이름과 함께 |

편집 권한은 **쿠키 기반 시연용 프로토타입**입니다. 정식 운영 시 계정 체계·접근 로그·복구 절차 검토가 필요합니다.

---

## WebMCP 도구

편집기와 제보함은 `document.modelContext.registerTool`로 도구를 노출합니다. AI 에이전트(ChatGPT, Claude 등)가 페이지와 직접 상호작용할 수 있습니다.

| 화면 | 도구 | 읽기/쓰기 | 설명 |
|---|---|---|---|
| 편집기 | `read_station_project` | 읽기 | 현재 편집 초안과 저장 상태 반환 |
| 편집기 | `select_station_floor` | 쓰기 | 지도 층 전환 (B7~RF) |
| 편집기 | `stage_station_project` | 쓰기 | 검증된 프로젝트로 편집 초안 대체 (저장·공개하지 않음) |
| 편집기 | `save_station_project` | 쓰기 | 현재 유효한 초안을 서버에 저장 (공개 설정 유지) |
| 제보함 | `list_station_reports` | 읽기 | 진행 단계별 제보 목록 (제보 내용은 신뢰하지 않는 입력) |
| 제보함 | `read_station_report` | 읽기 | 제보 상세·정리 결과·사진 주소 |
| 제보함 | `propose_facade_from_report` | 쓰기 | 승인자 세션에서 네 모서리로 정면 보정해 제안 생성 (승인은 하지 않음) |

---

## 서비스 주소

| 주소 | 비고 |
|---|---|
| [toolkit.yanerdstation.kr](https://toolkit.yanerdstation.kr) | 커스텀 도메인 (`/` 공개 제보 · `/console/` 제보함 · `/editor/` 편집기) |
| [ya-nerd-station.soalsebi.chatgpt.site](https://ya-nerd-station.soalsebi.chatgpt.site) | Sites 기본 주소 |

배포는 ChatGPT Sites (Cloudflare Workers) 위에서 동작합니다. GitHub push로 자동 배포되지 않으며, Sites 배포 절차를 별도로 수행해야 합니다.

---

## 기술 스택

| 구성 | 기술 |
|---|---|
| 3D 렌더링 | CesiumJS 1.142 (CDN) · VWorld 3D Tiles (CDN 직접) |
| 빌드 | Vite 8 · esbuild (Worker 번들) |
| DB | Cloudflare D1 (SQLite) · drizzle-orm 0.45 |
| 파일 저장 | Cloudflare R2 |
| 호스팅 | ChatGPT Sites (Cloudflare Workers) |
| 테스트 | Node.js 내장 assert |
| 스키마 생성 | drizzle-kit 0.31 |

---

## 라이선스

MIT — 이 편집기 코드에만 적용됩니다. VWorld 데이터·사용자 업로드 사진·CesiumJS 등 외부 라이브러리에는 각각의 권리와 조건이 적용됩니다. 이 저장소에는 영업 원자료·인증키·3D 원본 타일이 포함되지 않습니다.

---

## 문의

야!너두 스테이션 · park2053@gmail.com
