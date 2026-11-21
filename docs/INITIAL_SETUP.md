# Paperclip 포크 — Hermes-only 초기 설정

상태: 2026-11-22  
대상: **앱 코드 레포** (Paperclip MIT 포크). 스펙은 [hermes-paperclip-mvp.md](./hermes-paperclip-mvp.md).

## 목표

로컬에서 Paperclip 제어판(UI + API)을 띄우고, **새 에이전트 고용 시 Hermes만** 선택 가능하게 만든 뒤, [MVP 데모 시나리오](./hermes-paperclip-mvp.md#성공-기준-데모-시나리오)까지 도달한다.

## 0. 이 문서 repo와의 관계

| 저장소 | 역할 |
|--------|------|
| `rmngl/loop` (이 폴더) | 북극성·조사·MVP·설정 가이드만 |
| **포크 클론** (예: `rmngl/paperclip-hermes` 또는 private) | `paperclipai/paperclip` 수정·빌드·커밋 |

포크 README 상단에 링크: loop 문서의 `docs/hermes-paperclip-mvp.md`, `docs/INITIAL_SETUP.md`.

## 1. 선행 설치

### 제어판 (Paperclip)

- **Node.js** 22+ (Paperclip README / docs 기준 확인)
- **pnpm** 또는 **npm** (포크 저장소의 lockfile 따름)
- **PostgreSQL** (Paperclip은 Drizzle + Postgres)

### 런타임 (Hermes)

공식 Paperclip 어댑터 키: `hermes_local` / `hermes_gateway`  
문서: [Hermes adapter](https://docs.paperclip.ing/reference/adapters/hermes/)

```powershell
# Python 3.10+
python --version

# Hermes Agent (Paperclip env test가 제안하는 경로)
pip install hermes-agent

# 모델·프로바이더 — Hermes 자체 설정
# ~/.hermes/config.yaml 편집 (또는 Hermes 설치 문서 따름)
```

**Gateway만 쓸 경우:** Hermes API 서버가 켜져 있고 `API_SERVER_KEY`를 알고 있어야 한다.

### Windows 참고

- `hermes_local`은 Paperclip이 **Hermes 자식 프로세스**를 스폰 — WSL2 또는 네이티브 Python 중 팀이 선택한 쪽으로 통일
- Loopback gateway: `http://127.0.0.1:9119` 등 (Hermes 배포 문서 기준)

## 2. 포크 클론 및 부팅

```powershell
git clone --depth 1 https://github.com/paperclipai/paperclip.git C:\workspaces\paperclip-hermes
cd C:\workspaces\paperclip-hermes
git remote rename origin upstream
# git remote add origin <your-fork-url>
```

**이 PC 클론:** `C:\workspaces\paperclip-hermes` (2026-11-22 shallow clone 완료)

**로컬 인스턴스 (검증):** `%LOCALAPPDATA%\loop-paperclip-hermes-4` — `http://127.0.0.1:3100`. Postgres 잔여 시 `taskkill /F /IM postgres.exe` 후 새 `--data-dir`. 실행: `paperclip-hermes\scripts\loop-paperclip-run.ps1`

이후 포크에서:

1. `. .\scripts\loop-hermes-only-env.ps1` — Hermes-only UI 정책
2. `pnpm install` && `pnpm dev` **또는** `npx paperclipai@latest onboard --yes` (동일 env)
3. UI에서 Company → Hermes CEO → Task assign → Runs

상세: 포크 `docs/loop-hermes-only.md`

### 환경 변수 (Paperclip Core — 확정)

Upstream `doc/harness-availability.md`. **JSON 배열**. self-hosted 반영은 **`paperclip-hermes` fork 패치** (health 최상위 `availableHarnesses`).

| 변수 | 예시 | 효과 |
|------|------|------|
| `PAPERCLIP_AVAILABLE_HARNESSES` | `["hermes_local","hermes_gateway"]` | Hire/설정에서 허용 harness만 |
| (fork) health `availableHarnesses` | 위 env와 동일 | self-hosted onboard용 — `paperclip-hermes` fork 패치 |

`PAPERCLIP_CLOUD_TENANT_SERVER_TOKEN`은 **self-hosted onboard에 넣지 않음** (Cloud DB 부트스트랩 필요).

스크립트: `paperclip-hermes/scripts/loop-hermes-only-env.ps1`

## 3. Hermes-only 제품 플래그

**적용됨 (fork):** `server/src/routes/health.ts`, `ui/src/hooks/useCloudHarnessPolicy.ts` + `scripts/loop-hermes-only-env.ps1`.

Paperclip upstream은 Claude, Codex, Cursor 등 다수 어댑터를 내장한다. 카피캣은 **UI·hire·기본값**에서 Hermes만 노출한다.

### 구현 체크 (코드베이스에서 찾을 키워드)

- `hermes_local`, `claude_local`, `adapterType`, `built-in adapters`
- Agent create / **Harness** dropdown
- Settings → **Adapters** (Built-in vs External)
- `ADAPTER_ALLOWLIST` 또는 allowlist 배열

### 최소 동작

1. New Agent → 어댑터 선택 **Hermes (local)** 만 (Gateway는 advanced)
2. Settings → Adapters → built-in 목록 **Hermes 2종** (또는 local만 Phase 0)
3. 기존 DB에 다른 어댑터 agent가 있으면 **읽기 전용/마이그레이션** 정책 결정 (Phase 0: 새 Company만)

### NOTICE

MIT 유지 + `LICENSE` / upstream 저작권 표기. 제품명·리포지토리 이름은 Paperclip과 구분 (trademark).

## 4. Hermes 연결 검증 (패치 후)

### 4.1 Run test (UI)

1. Company 생성 (온보딩)
2. Agent hire: CEO, `hermes_local`, Advanced heartbeat:

```yaml
runtimeConfig:
  heartbeat:
    enabled: false
    wakeOnDemand: true
    skipTimerWhenNoActionableWork: true
```

3. Agent 페이지 **Harness / Run test** — 실패 시 transcript 또는 env test 메시지 저장

### 4.2 첫 실제 Run (MVP)

1. Task 생성 → CEO assign
2. Agent **Run now** 또는 assignment heartbeat
3. **Audit → Runs**에 transcript, Dashboard **Running** 플래시

실패 시 순서:

- Python / `hermes` on PATH
- `~/.hermes/config.yaml` API 키
- Paperclip → agent에 넘기는 `timeoutSec`
- Windows: shell spawn 경로

## 5. Phase 0 완료 체크

[MVP 수용 테스트](./hermes-paperclip-mvp.md#수용-테스트) T1–T5:

- [ ] T1 Hermes 미설치 시 명확한 안내
- [ ] T2 Assign → Run 1건 + issue 진행 흔적
- [ ] T3 실패 시 error + Runs transcript
- [ ] T4 Dashboard running 카운트
- [ ] T5 Adapters에 non-Hermes **미표시**

## 6. 선택: Docker / 시드

팀 온보딩용:

- `docker-compose.yml`: Postgres + Paperclip server (upstream 배포 문서 따름)
- `scripts/seed-phase0.mjs`: Company + CEO Hermes agent + sample issue (API 키는 env)

## 7. 다음 문서 (포크 repo에 추가 권장)

| 파일 | 내용 |
|------|------|
| `docs/HERMES_ONLY.md` | allowlist env, known limitations |
| `docs/DEV.md` | 포크 전용 dev 명령, DB reset |
| `.env.example` | DB URL, `ADAPTER_ALLOWLIST`, secrets |

## 참고

- [Paperclip GitHub](https://github.com/paperclipai/paperclip)
- [Quickstart](https://docs.paperclip.ing/)
- [Choosing an Agent Adapter](https://docs.paperclip.ing/guides/org/agent-adapters/)
- loop: [paperclip-research.md](./paperclip-research.md) · [hermes-paperclip-mvp.md](./hermes-paperclip-mvp.md)