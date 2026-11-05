# 로컬 Codex 사진 초안 작업자

`tools/codex-draft-worker.mjs`는 공개편집기에 맡겨진 사진 작업을 로컬 Codex가 읽고 **비공개 초안 또는 보완 질문까지만** 저장하도록 연결한다. 최종 승인과 운영 지도 반영은 기존 승인자 화면에서 사람이 수행한다.

새 시스템 서비스나 네트워크 포트를 만들지 않는다. 설치된 `codex`를 일시적인 `app-server --listen stdio://` 자식 프로세스로 실행하고, 종료할 때 자신이 띄운 자식만 종료한다. 사용자가 실행하지 않은 앱을 자동 조종하거나 기존 앱의 제어 소켓을 재사용한다고 주장하지 않는다.

## 실행 전 확인

- Codex CLI를 설치하고 `codex login`으로 로그인한다. 작업자는 `codex login status`의 성공 여부만 확인하며 `auth.json`이나 자격증명 본문을 읽지 않는다.
- Codex에서 공개편집기 MCP를 사용할 수 있어야 한다. 플러그인 설치와 편집기 승인자의 일회용 **초안 전용 계정 연결**은 별개다. 연결이 없거나 만료되면 작업자는 중단한다.
- 편집기 MCP에 최신 도구가 필요하다: 연결 상태, 작업 목록/상세, 원본 사진, 기존 파사드 비교, 아티팩트 저장, 계획 제출, 보완 질문. 구버전 MCP는 누락 도구를 명시하고 중단한다.
- 모델 이름·서비스 티어·요금제·이미지 모델을 하드코딩하지 않는다. 로그인 계정의 `model/list`에서 이미지 입력을 지원하는 공개 기본 모델(`isDefault`)을 선택한다. `--model NAME`을 지정하면 같은 카탈로그에서 검증하며, 임의의 미지원 모델로 바꾸지 않는다. 선택 모델의 기본 reasoning effort를 사용한다. 전역 Codex 설정은 변경하지 않는다.

```bash
node tools/codex-draft-worker.mjs --check
node tools/codex-draft-worker.mjs --once
node tools/codex-draft-worker.mjs --once --job JOB_UUID
node tools/codex-draft-worker.mjs --watch --workspace /absolute/private/work-folder
```

`--check`는 CLI·로그인·MCP 설치·계정 연결·도구 계약을 점검한다. 모델 턴을 시작하지 않는다. 결과의 `image_generation: not_verified`는 의도적이다. **Codex 앱에서 쓰던 모든 이미지 편집 기능이 별도 CLI 프로세스에도 제공된다고 보장할 수 없다.** 이미지 편집 기능이 실제로 없으면 원본 사영으로 충분한 작업만 처리하거나, 보완 질문/앱 인계로 끝내야 한다. 실행을 완료했다고 기록해서는 안 된다.

읽기 권한도 이름만 점검하지 않는다. 실제 OS 샌드박스에서 합성 작업 파일의 읽기/쓰기와 설치 도구 런타임 읽기는 성공하고, 합성 외부 파일과 symlink 탈출 읽기는 차단되는지 모델 없이 확인한다. 성공해야 `filesystem_canary: passed`가 표시된다. 차단을 강제할 수 없는 환경에서는 권한을 풀어서 진행하지 않는다.

`--once`와 `--watch`는 실제 모델 사용을 시작하므로 계정 사용량을 소비할 수 있다. watch는 기본 30초 간격으로 명시적으로 맡겨진 `awaiting_external` 작업만 읽는다. 운영체제 로그인 시 자동 시작하는 설정은 설치하지 않는다.

`--watch --job JOB_UUID`는 최초 작업의 **report_id**에 범위를 고정한다. 질문/초안 저장 후에도 대기하며 `toolkit_read_conversation.current_job_id` 또는 같은 제보의 최신 작업을 따라 관리자의 추가 답변을 처리한다. 실행 중 새 메시지가 오면 이전 턴을 취소하고 새 작업을 읽는다. 오래된 작업의 409 갱신은 같은 제보의 후속 작업으로 이어가며 계정 연결 만료·권한 철회는 중단한다. 다른 제보로 자동으로 범위를 넓히지 않는다.

## 이미지 바이트와 모델 문맥 분리

1. `station_read_photo_to_file({photo_id})`가 현재 작업의 원본 사진을 MCP로 읽는다.
2. 작업자 코드가 image content를 디코딩해 작업별 `inputs/`에 비공개 파일로 저장한다. 모델에는 경로·SHA-256·픽셀 크기만 반환한다. 모델은 `view_image`나 사용 가능한 이미지 편집 도구에 이 경로를 전달한다. 직접 이미지로 확인하려면 `station_read_photo`도 사용할 수 있다.
3. 모델이 생성/보정한 결과는 해당 작업 폴더의 `artifacts/`에 둔다.
4. `station_upload_local_artifact({path,source_photo_ids,provenance})`가 로컬 파일 경로만 받는다.
5. 작업자가 realpath로 작업 폴더 범위, 일반 파일 여부, PNG/JPEG magic·헤더·용량·픽셀 한도를 검사한다. 이미지 base64는 이 코드 내부에서 MCP 요청으로만 전송한다.
6. 모델에는 `artifact_id`, 서버 해시·규격·출처만 반환한다. 계획의 `faces`는 해당 아티팩트 ID를 참조한다.

내장 이미지 생성 도구가 작업 폴더 밖에 저장한 경우 모델의 파일 읽기 범위를 넓히지 않는다. 작업자는 **소유한 활성 thread와 실제 turn ID**의 `imageGeneration` 완료 이벤트를 받고 `item.id`와 `savedPath`만 호스트 메모리에 등록한다. `result` 이미지 본문·재작성 프롬프트·원래 호스트 경로는 로그나 도구 텍스트로 전달하지 않는다.

`station_import_generated_image({})`는 그 턴에서 실제 완료된 이벤트 ID 목록을 반환한다. `{item_id}`를 지정하면 등록된 이벤트 파일 하나만 O_NOFOLLOW·일반 파일·magic·크기 검사 후 작업 폴더 `artifacts/`에 복사한다. 경로 인자는 받지 않으며 다른 thread/turn·미완료·미등록 이벤트와 마지막 경로가 symlink인 파일은 거부한다. 같은 이벤트의 병렬 재시도는 같은 복사본을 반환한다. 결과를 실제로 검수하고 파사드 규격을 맞춘 후 기존 아티팩트 업로드 도구에 그 로컬 경로를 전달한다.

이미지 한도는 4.8MB, 한 변 4096px, 전체 4,194,304px이다. 예전 프레퍼스 규격 2146×733은 범위 안이다. 로컬 검사는 사전 검사이며 최종 디코딩·메타데이터 제거·재인코딩·해시는 서버가 다시 수행한다. provenance에는 `generated|rectified`, 근거·불확실성 각 1~1000자, `privacy_reviewed: true`, 현재 작업의 원본 사진 ID가 필요하다.

**이미지 바이트를 모델의 JSON 도구 인자·프롬프트·셸 출력에 펼치지 않는다.** 원본과 결과는 별도 파일로 보존한다. 로컬 작업 폴더는 원본 사진을 포함하므로 작업 완료 후 보존/삭제는 운영자가 결정한다. 원본은 기본 0700 폴더·0600 파일로 저장한다.

## 실행 경계

제어용 ephemeral thread는 모델 턴을 실행하지 않고 MCP 연결만 소유한다. 실제 모델 thread에는 제한된 `station_*` 동적 도구를 제공하고 기본 앱과 설정된 외부 MCP 서버를 비활성화한다. 모델의 편집기 작업은 제어 thread를 이용한 좁은 bridge를 통해서만 수행한다. app-server의 가상 내장 도구는 해당 런타임의 정책을 따른다.

app-server 호스트는 MCP 인증에 필요한 환경을 유지하지만 모델의 셸은 `inherit: none`으로 분리하고 Node 런타임 중심 PATH·LANG·`OPENSSL_CONF=/dev/null`만 전달한다. 마지막 설정은 호스트의 사용자별 SSL 설정을 읽지 않도록 한다. bridge의 MCP 호출과 사용 가능한 내장 이미지 도구는 별도 호스트 경로를 이용한다.

모델 턴은 임시 named permission profile `station_photo_draft_job`을 사용한다. `:root`·일반 임시 폴더 읽기를 거부하고 `:minimal` 시스템 런타임, 현재 작업 폴더의 읽기/쓰기, 설치 Node·필요 동적 라이브러리·편집기 도구 모듈의 읽기만 허용한다. 현재 작업의 `.codex`·`.aws`·`.ssh`·`.git`·`.agents`는 별도로 거부한다. 일반 명령 네트워크는 꺼져 있다. 홈·다른 작업·원본 코드베이스를 읽을 필요는 없다.

이 프로필은 app-server 실행 인자에만 정의하며 전역 설정 파일을 바꾸지 않는다. thread/turn은 `permissions`와 정확한 `runtimeWorkspaceRoots`를 지정하고, 반환된 `activePermissionProfile.id`와 workspace가 일치해야 진행한다. legacy `sandbox`/`sandboxPolicy`와 혼합하지 않는다. 설치 0.145.0 스키마에는 최신 문서의 `readOnlyAccess` 필드가 없어 실제 지원되는 named profile을 사용했다. macOS는 Seatbelt가 이 제한을 강제한다. 자세한 의미와 플랫폼 범위는 공식 [Permissions 문서](https://learn.chatgpt.com/docs/permissions)를 따른다. MCP·커넥터·호스트 내장 도구는 각각의 별도 접근 제어도 적용한다.

`config/read(includeLayers:false)`로 확인한 실제 MCP 설정은 프로세스 메모리 안에서만 사용한다. 비활성 모델 thread에는 유효한 url 또는 command/args transport만 남기고 헤더·환경·토큰·timeout 등 나머지 필드를 전달하지 않는다. 유효 설정의 빈 선택 필드를 TOML로 재직렬화해 생기는 오류를 피하며 설정 원문·헤더·비밀값을 로그나 상태파일에 남기지 않는다. 상태 목록에만 존재하는 가상 내장 서버를 transport 없는 새 MCP 설정으로 만들지 않는다.

- 허용: 현재 작업·대화 읽기, 작업 원본·허용 파사드 비교 읽기, 검증된 로컬 결과의 비공개 아티팩트 저장, 계획 제출, 보완 질문.
- `station_read_file(file_id)`는 전송된 TXT/Office 본문과 이미지를 읽는다. PDF의 base64는 모델 텍스트로 펼치지 않고 비공개 `files/`에 저장한 경로·해시를 반환한다. 사용 가능한 로컬 PDF 읽기 도구로 확인하며 문서의 코드·수식·매크로는 실행하지 않는다.
- `station_send_message(text)`는 bridge가 최신 관리자 메시지와 현재 작업을 다시 읽고 `after_message_id`와 결정론적 `request_id`를 붙인다. 모델이 다른 대화·과거 메시지를 답변 대상으로 선택할 수 없다.
- 제공하지 않음: 계정 연결 코드 사용, 승인자 로그인/쿠키, 최종 승인, 콘솔 API, 임의 SQL·URL 호출, 사이트 배포.
- 추가 명령·파일·네트워크 권한 승인 요청은 자동 허용하지 않는다. 이 때문에 작업이 멈추면 Codex 앱에서 사람이 검토한다.
- 사진·설명·기존 대화는 외부 증거로 다룬다. 그 안의 문구가 실행 권한을 넓히지 않는다.

작업 전과 이미지 저장/계획 제출 직전에 작업을 다시 읽고 서버가 최신 대화·제보·연결·만료를 검사한다. 모델 답변의 “완료”만 보고 성공 처리하지 않으며, 서버에서 실제 `draft` 또는 `needs_info` 상태를 읽어야 성공으로 기록한다. 일부 저장 후 실패하면 생성 아티팩트는 비공개 상태로 남을 수 있다.

같은 작업/이미지 해시/출처/보정근거는 같은 `request_id`를 사용한다. 작업폴더의 `state.json`에는 처리한 작업 버전과 아티팩트 메타데이터만 저장하며 이미지 base64·토큰을 저장하지 않는다. 이미 처리한 같은 작업 버전은 watch에서 재실행하지 않는다. 중간 실패 후 다시 실행할 때도 서버 재전송 검사를 받는다.

중복 작업자는 `worker.lock`으로 막는다. 비정상 강제 종료 후 lock이 남으면 PID의 실제 실행 여부를 사람이 확인하고 해당 lock만 정리한다. 작업자가 임의의 다른 프로세스를 종료하지 않는다. Ctrl+C/SIGTERM은 현재 턴 취소와 소유 자식 정리를 수행한다. 기본 작업 제한 시간은 15분이며 `--timeout-ms`로 조정할 수 있다.

프로토콜 JSON 손상·과대 응답으로 논리 연결이 먼저 종료돼도 자식 정리를 건너뛰지 않는다. `close()`는 중복 호출에 같은 종료 Promise를 반환하고 stdin 종료·SIGTERM 후 실제 exit를 기다린다. 2초 안에 끝나지 않은 소유 자식만 SIGKILL하며 종료 확인 실패도 명시적으로 반환한다.

## 로컬 통합 검증용 MCP 주소

설치 MCP 대신 명시적으로 지정한 서버도 사용할 수 있다. HTTPS 또는 `http://127.0.0.1`만 허용한다. URL의 사용자명·비밀번호·query·fragment는 거부한다. 토큰 값은 명령줄에 넣지 않는다.

```bash
# 환경변수의 실제 값은 별도 비공개 수단으로 주입한다.
node tools/codex-draft-worker.mjs --check \
  --mcp-url http://127.0.0.1:4197/mcp \
  --token-env STATION_PHOTO_FIXTURE_TOKEN \
  --workspace /private/tmp/station-photo-codex-worker
```

작업자는 app-server에 `mcp_servers.station_photo.url`과 `bearer_token_env_var` **이름**만 전달한다. 전역 Codex 설정 파일을 변경하지 않는다. fixture를 시작하거나 포트를 여는 기능은 이 작업자에 없다. 운영과 분리된 fixture임은 별도로 검증해야 한다.

## 검증 근거와 남은 확인

프로토콜 입력은 설치된 **codex-cli 0.145.0**의 `app-server generate-json-schema --experimental` 결과로 확인했다. 해당 버전은 `dynamicTools`의 `type: function`, `inputSchema`, `item/tool/call`, `mcpServerStatus/list`, `mcpServer/tool/call`의 `server/threadId/tool`을 제공한다. 공식 [App Server 문서](https://learn.chatgpt.com/docs/app-server#dynamic-tool-calls-experimental)에서 동적 도구가 실험적 API임을 명시한다.

```bash
node tools/test-codex-draft-worker.mjs
# 실제 OS 격리도 검사. 합성 파일만 사용하며 모델은 호출하지 않는다.
node tools/test-codex-draft-worker.mjs --live-sandbox
```

위 테스트는 설치/계정 점검·MCP discovery·한정 경로 업로드·symlink 탈출 차단·PNG 크기·출처·재전송 ID·오래된 작업·stdio 분할 응답/종료/시간 초과·모의 once/watch/check를 검증한다. 외부 모델·운영 제보·실제 승인·배포를 호출하지 않는다.

2026-11-06 macOS·CLI 0.145.0에서 실제 named profile을 선택하고 Node·설치 도구 런타임 읽기와 작업 파일 쓰기, 합성 외부 파일 및 symlink 읽기 차단을 확인했다. 실제 자격증명 파일이나 운영 사진을 읽는 검사는 하지 않았다. 내장 생성 이벤트의 thread/turn 바인딩, 임의 경로 거부, 파일 제한, 병렬 재전송 및 이벤트→가져오기→업로드→draft는 모의 테스트로도 확인한다.

2026-11-06 격리된 로컬 fixture에서 실제 ChatGPT 로그인·설치 CLI 0.145.0·카탈로그 기본 모델 선택으로 `--check`와 `--once`를 확인했다. 모델이 촬영 시점 보완 질문을 MCP로 저장했고 서버의 `needs_info` 상태를 읽은 뒤 exit 0으로 끝났다. 이 검증은 실제 질문 왕복이며 생성형 이미지 편집 성공이나 운영 지도 반영의 근거는 아니다.

이어 관리자 답변으로 생성된 후속 작업에서 실제 CLI가 원본 사진을 로컬로 받고 2146×733px 보정 PNG를 만들었다. 경로 기반 아티팩트 저장과 계획 제출이 서버의 비공개 `draft` 상태까지 이어졌고 exit 0으로 끝났다. 이 두 번째 검증은 결정론적 규격 보정으로 충분한 사례였다. 가림 부분의 생성형 인페인팅 호출은 이 근거에 포함하지 않는다.

세 번째 검증에서는 실제 `--watch --job`을 실행했다. 초기 작업의 보완 질문 저장 후 관리자 답변으로 생긴 후속 작업을 같은 제보 범위에서 자동 추적했다. 실제 내장 이미지 생성·편집이 완료되고, 소유 thread/turn의 이벤트에 등록된 결과를 작업 폴더로 가져와 2146×733px PNG로 규격을 맞춘 뒤 비공개 `draft` 제출까지 성공했다. 실행 기록은 `image_generation_completed`, `saved_image_registered: true`, 최종 `status: draft`를 확인했다. 개별 실행과 비공개 제안 식별자는 공개 문서에 포함하지 않는다.

이 시험은 파사드에 **가상의 TEST 표지**를 추가하는 생성형 편집이었다. 실제 출력 파일에서 표지를 확인했으며, 현장 최신화 결과로 승인하지 않았다. 원본의 가구와 세부 형상이 함께 재구성된 부분도 있어 요청한 부분 외의 변형 가능성이 확인됐다. 따라서 이 성공은 **실제 생성형 편집→이벤트 기반 가져오기→규격 보정→비공개 초안 반환의 연결**을 입증한다. 사진의 관측 사실이나 세부 형상이 정확하게 보존됐다는 보장은 아니다. 실제 업무에는 원본과 모든 결과 면의 비교, 개인정보 확인, 생성 부분·불확실성 표시와 사람의 최종 승인이 계속 필요하다.

생성형 시험안에는 최종 승인을 호출하지 않았고 운영 지도도 바꾸지 않았다. 소유한 작업자에는 SIGTERM을 전달했다. 실제 운영 Sites OAuth와 배포된 MCP의 사용자 계정 연결은 이번 로컬 fixture 검증에 포함하지 않는다. `--check`의 `image_generation: not_verified`는 그 점검 실행이 모델·이미지 생성을 호출하지 않았다는 뜻이며, 위 별도 실증의 성공 여부와 구분한다. 모의 테스트나 단순 연결 점검만으로 생성형 처리가 성공했다고 표시하지 않는다. 실패 로그는 `failed`와 앱 인계 안내를 반환한다.
