<div align="center">

# 야!너두 스테이션 편집기

### VWorld 실내 3D 지도 위에 변경 레이어를 관리하는 공개 편집기

원본 3D 모델은 건드리지 않고, 현장에서 바뀐 부분만 덧씌웁니다

<br/>

![VWorld](https://img.shields.io/badge/공간원본-VWorld%203D%20Tiles-0A5EB0)
![CesiumJS](https://img.shields.io/badge/렌더러-CesiumJS%201.142-3F4F75)
![D1](https://img.shields.io/badge/DB-Cloudflare%20D1-F38020)
![R2](https://img.shields.io/badge/업로드-Cloudflare%20R2-F38020)
![역](https://img.shields.io/badge/실내지도-46개%20KTX역-D4A843)
![MIT](https://img.shields.io/badge/license-MIT-green)

**[편집기 열기](https://toolkit.yanerdstation.kr)** · **[프로젝트 소개](https://yanerdstation.kr)** · **[서울역 프로토타입](https://seoul.yanerdstation.kr)** · **[본체 리포](https://github.com/Kminer2053/digitaltwin-station)** (private)

</div>

---

## 왜 이 도구인가

| 기존 방식 | 이 편집기 |
|---|---|
| 원본 3D 모델을 직접 수정 · 수정 이력 소실 | 원본 유지 + 변경 레이어 분리 · revision 추적 |
| 역마다 전용 도구 · 재사용 불가 | 46개 KTX역에 동일 스키마·동일 UI |
| 데이터(시설·유동·매출) 별도 관리 | 구조물→파사드→포인트→경로→데이터 한 화면 |
| AI 연동 없음 | WebMCP로 읽기·편집·저장 도구 노출 |

[야!너두 스테이션](https://yanerdstation.kr) 프로젝트의 구축 도구이며, **Station One** 시리즈 프로토타입(서울역·대전역)의 편집 데이터를 열람하고 나머지 44개 역의 편집을 시작할 수 있습니다.

---

## 46개 KTX역 — VWorld 실내지도 보유

| 상태 | 역 |
|---|---|
| **연결 완료** | 서울역 (`S202103`) · 대전역 (`S201801`) |
| **연결 준비 중** | 강릉 · 계룡 · 곡성 · 공주 · 광명 · 광주송정 · 구례구 · 김천구미 · 나주 · 남원 · 논산 · 동대구 · 마산 · 목포 · 부산 · 부전 · 상봉 · 서대구 · 서대전 · 서원주 · 수원 · 순천 · 신경주 · 안동 · 여수엑스포 · 여천 · 오송 · 용산 · 울산 · 원주 · 익산 · 정읍 · 제천 · 진부 · 진영 · 진주 · 창원 · 창원중앙 · 천안아산 · 청량리 · 평창 · 평택 · 포항 · 행신 |

연결 준비 중인 역은 VWorld 건물 ID(`SxxxxXX`) · 중심 좌표(WGS84) · 층 목록 · 기준 고도를 입력하면 바로 같은 UI로 편집할 수 있습니다. 편집기 드롭다운에서 역을 선택하면 연결 설정 다이얼로그가 열립니다.

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

모든 탭에서 등록 항목은 이름·ID·층·역할로 검색할 수 있고, 지도 클릭으로 좌표가 자동 입력됩니다.

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

서울역 선택 시 편집기는 본체(Station One)의 최신 파사드·시설을 `<iframe>` postMessage로 실시간 반영하므로, 편집기 자체 CesiumJS 인스턴스가 아닌 본체 렌더러에서 서울역을 표시합니다.

---

## 디렉터리 구조

```
toolkit/
├── index.html                  편집기 메인 페이지 (단일 HTML)
├── package.json                ya-nerd-station-editor · Vite 8 · esbuild · drizzle-orm
├── vite.config.js              dev 4197 · 빌드 outDir · esbuild Worker 번들
├── drizzle.config.ts           drizzle-kit: D1 스키마 생성
├── LICENSE                     MIT
├── UPSTREAM.json               본체 리포 싱크 메타데이터
├── src/
│   ├── main.js        (100행) 편집기 메인: 탭·목록·폼·저장·불러오기·공유·WebMCP
│   ├── model.js        (27행) 프로젝트 스키마·검증·샘플·대전 초안 생성
│   ├── scene.js        (47행) 이중 렌더: 서울=iframe postMessage / 그 외=CesiumJS 네이티브
│   ├── seoul-snapshot.js (27행) 서울 스냅샷 API → 편집기 프로젝트 스키마 변환
│   ├── stations.js     (61행) 2개 연결역 + 46개 카탈로그 + 유효성 검증 함수
│   └── style.css              편집기 전체 스타일 (다크 테마)
├── server/
│   └── index.js        (51행) Cloudflare Workers fetch 핸들러: 전체 API
├── db/
│   └── schema.ts              drizzle-orm D1 스키마 정의 (2 테이블)
├── drizzle/
│   └── 0000_high_sleepwalker.sql   생성된 CREATE TABLE SQL
├── tools/
│   ├── test.mjs               메모리 저장소 · CRUD · 검증 · 충돌 감지 테스트
│   ├── test-seoul.mjs         서울 스냅샷 어댑터 테스트
│   ├── local-api.mjs          로컬 SQLite 서버 (개발용)
│   └── local-scene.mjs        VWorld 타일 로컬 프록시 (개발용)
├── public/
│   └── favicon.svg            편집기 파비콘
├── dist/                      빌드 출력: 정적 클라이언트 + Worker 번들
├── data-private/              로컬 SQLite DB · 업로드 (gitignore)
└── .openai/
    └── hosting.json           ChatGPT Sites 호스팅 설정
```

---

## 실행

```bash
npm ci
npm run dev          # http://127.0.0.1:4197/
```

로컬 API 서버 (SQLite 기반):

```bash
node tools/local-api.mjs    # http://127.0.0.1:4198/
```

로컬 VWorld 타일 프록시 (대전역):

```bash
node tools/local-scene.mjs   # http://127.0.0.1:4199/
```

빌드:

```bash
npm run build        # dist/ 생성 (정적 클라이언트 + esbuild Worker)
```

Node.js 22.13 이상이 필요합니다. VWorld 3D Tiles를 사용하므로 인터넷 연결이 필요합니다.

---

## 테스트

```bash
npm test                    # 메모리 저장소 CRUD · 프로젝트 검증 · 충돌 감지
node tools/test-seoul.mjs   # 서울 스냅샷 어댑터 변환 검증
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

## API 엔드포인트

### 서울역 읽기 전용 (프록시)

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/seoul/snapshot` | GET | revision 334 확정 설정 전체 (원점·시설·파사드·경로·데이터) |
| `/api/seoul/hourly?origin=ID` | GET | 원점별 시간대 유동 데이터 JSON |

쓰기 요청 시 `423 Locked` 반환.

### VWorld 타일 프록시

| 경로 | 메서드 | 설명 |
|---|---|---|
| `/api/map-source/:stationId/tileset.json` | GET | VWorld 3D Tiles 메타데이터 |
| `/api/map-source/:stationId/:tile.b3dm` | GET | VWorld B3DM 타일 바이너리 |

역 ID 형식 `S\d{6}` · 5분 캐시 · HEAD 지원. VWorld CDN 장애 시 `503`.

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

---

## 데이터 모델

### D1 테이블 스키마

```sql
CREATE TABLE editor_projects (
  id          TEXT PRIMARY KEY,
  owner_hash  TEXT NOT NULL,       -- SHA-256(쿠키 UUID)
  name        TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 0,
  shared      INTEGER NOT NULL DEFAULT 0,
  body        TEXT NOT NULL,       -- JSON (validateProject 통과)
  updated_at  TEXT NOT NULL
);
CREATE INDEX editor_projects_owner ON editor_projects(owner_hash);

CREATE TABLE editor_files (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  mime        TEXT NOT NULL,       -- image/png | image/jpeg
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);
```

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

## 보안 모델

| 항목 | 구현 |
|---|---|
| 편집 권한 | HttpOnly 쿠키 (`nerd-owner`) · UUID → SHA-256 해시 비교 |
| CSRF | 요청 Origin ≠ 사이트 Origin → `403` |
| 서울역 잠금 | `saveLocked()` → UI 비활성 + 서버 `423 Locked` 이중 차단 |
| 업로드 검증 | 매직 바이트(PNG `89504E47` / JPEG `FFD8FF`) · 4MB · 프로젝트당 100장 |
| 저장 한도 | 브라우저당 30프로젝트 · 전체 200 · body 합계 64MB · 파일 합계 100MB |
| 공개 링크 | `shared=1`이면 GET 허용 · 쓰기 차단 · "복사 후 편집" |

편집 권한은 **쿠키 기반 시연용 프로토타입**입니다. 정식 운영 시 계정 체계·접근 로그·복구 절차 검토가 필요합니다.

---

## WebMCP 도구

편집기는 `document.modelContext.registerTool`로 4개 도구를 노출합니다. AI 에이전트(ChatGPT, Claude 등)가 편집기 페이지와 직접 상호작용할 수 있습니다.

| 도구 | 읽기/쓰기 | 설명 |
|---|---|---|
| `read_station_project` | 읽기 | 현재 편집 초안과 저장 상태 반환 |
| `select_station_floor` | 쓰기 | 지도 층 전환 (B7~RF) |
| `stage_station_project` | 쓰기 | 검증된 프로젝트로 편집 초안 대체 (저장·공개하지 않음) |
| `save_station_project` | 쓰기 | 현재 유효한 초안을 서버에 저장 (공개 설정 유지) |

---

## 서비스 주소

| 주소 | 비고 |
|---|---|
| [toolkit.yanerdstation.kr](https://toolkit.yanerdstation.kr) | 커스텀 도메인 |
| [ya-nerd-station.soalsebi.chatgpt.site](https://ya-nerd-station.soalsebi.chatgpt.site) | Sites 기본 주소 |

배포는 ChatGPT Sites (Cloudflare Workers) 위에서 동작합니다. GitHub push로 자동 배포되지 않으며, Sites 배포 절차를 별도로 수행해야 합니다.

---

## 기술 스택

| 구성 | 기술 |
|---|---|
| 3D 렌더링 | CesiumJS 1.142 (CDN) · VWorld 3D Tiles |
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
