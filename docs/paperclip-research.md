# Paperclip 조사 (Hermes 기반 copycat용)

상태: 2026-11-22 조사  
출처: [paperclip.ing](https://paperclip.ing), [docs.paperclip.ing](https://docs.paperclip.ing), [github.com/paperclipai/paperclip](https://github.com/paperclipai/paperclip) (MIT)

## 한 줄 요약

Paperclip은 **Node 서버 + React UI 제어판(control plane)** 이고, LLM은 **어댑터**로 붙입니다. 공식 빌트인에 **`hermes_local` / `hermes_gateway`** 가 이미 있습니다.  
「Hermes만 쓰는 Paperclip 카피캣」은 (1) **Paperclip 포크 후 Hermes 전용으로 좁히기** 또는 (2) **UI·API 패리티를 맞춘 그린필드** 중 하나로 가는 게 현실적입니다.

## 제품 정체

| 표면 | 실제 |
|------|------|
| 겉모습 | Jira/Linear 같은 **태스크 매니저** |
| 안쪽 | **회사(Company)** 단위: 목표, 조직도, 예산, 거버넌스, 하트비트 실행 |

네 기둥(마케팅):

1. **Agentic Task Manager** — 이슈(Tasks), 승인, 루틴, 검증  
2. **Org Chart for Agents** — 역할, 위임, 권한, 시크릿 스코프  
3. **Agent Employee Training** — Skill Studio, eval, 버전  
4. **Agentic OS** — 어댑터, MCP/연결, 비용, 감사

서버 내부 모듈(README 다이어그램): Identity & Access, Work & Tasks, Heartbeat Execution, Governance & Approvals, Org Chart & Agents, Workspaces & Runtime, Plugins, Budget & Costs, Routines, Secrets, Activity, Company Portability.

## 핵심 개념 (데이터 모델)

| 개념 | 역할 |
|------|------|
| **Company** | 격리 경계: 목표, 월 예산, 에이전트·태스크·비용 전부 소속 |
| **Agent** | AI 직원: 직함, 상사 1명, 어댑터, 예산, `runtimeConfig` (heartbeat YAML) |
| **Task (Issue)** | 티켓: `backlog → todo → in_progress → in_review → done` / `blocked` / `cancelled`, **단일 checkout** |
| **Heartbeat** | 짧은 실행 창: 트리거 → 어댑터 기동 → 런타임 → Paperclip API → Run 기록 |
| **Adapter** | Paperclip ↔ 실제 런타임 (Claude, Codex, **Hermes**, HTTP, …) |
| **Budget** | 회사/에이전트 월 한도, 80% 경고, 100% 자동 pause |
| **Approval** | 전략 승인, hire 승인, 예산 override 등 게이트 |

### Heartbeat 트리거

- **Timer** (`runtimeConfig.heartbeat.enabled`, `intervalSec`) — 기본 **꺼짐**, 노이즈 방지  
- **Assignment** — 태스크 배정  
- **Comment** — 배정된 태스크에 댓글 (@멘션 단독은 아님)  
- **On demand** — UI “Wake now”, `wakeOnDemand: true`  
- **Routine** — 스케줄/웹훅이 이슈 생성 후 배정  
- **Approval resolution**

권장 기본값: `enabled: false`, `wakeOnDemand: true`, `skipTimerWhenNoActionableWork: true`.

### Heartbeat 실행 6단계 (에이전트 가이드)

1. Trigger  
2. Adapter invocation  
3. Agent process (런타임 스폰)  
4. Paperclip API (과제 claim, 상태, 작업)  
5. Result capture (출력, usage, cost, session)  
6. Run record (감사/디버그)

## UI 맵 (copycat 패리티 기준)

문서 IA 기준. 실제 앱은 **Coordinator** vs **Classic** 워크스페이스로 Inbox 위치가 약간 다름.

### 사이드바·주요 라우트

| 영역 | 화면 | 기능 요약 |
|------|------|-----------|
| **Day-to-day** | Dashboard | 에이전트 상태 카드, Tasks in progress, Month spend, Pending approvals, 14일 차트, Recent activity/tasks |
| | Tasks (`/issues`) | 필터(상태·담당·프로젝트·라벨), 검색, 인박스 뷰(Mine/Unread/Blocked/…), 서브태스크 트리 |
| | Approvals | 전략·hire·예산 등 대기 결재 |
| | (Inbox) | 사람용 결정 큐 (Classic vs Coordinator 차이) |
| **Org** | Agents (`/agents/all`) | 목록, bulk edit connection/model, New Agent, 상태(active/running/error/paused) |
| | Agent detail | Overview 타일, Identity, Advanced(YAML heartbeat), Harness/Runtime, Instructions(AGENTS.md 등), Skills, **Audit**: Activity / Runs / Costs / Budgets |
| | Org chart | 계층·보고 라인 (스크린샷: org-chart-view) |
| **Projects & workflow** | Projects, Goals, Routines | 목표 정렬, 스케줄 job → 이슈 생성 |
| **Connectors** | Settings → Adapters, Connections | 런타임 등록, GitHub/Notion/MCP 등 |
| **Administration** | Company settings, Skills, Plugins, CLI auth | 멀티 컴퍼니, Skill Studio |
| **Audit (회사)** | Activity, Budgets | 회사 전체 감사 |

### 에이전트 페이지 사이드 메뉴 (복제 시 필수)

- **Agent**: Overview, Identity, Advanced, Harness/Runtime, Instructions, Skills (+ 플러그인 Apps)  
- **Audit**: Activity, Runs, Costs, Budgets  

### 대시보드 위젯 (MVP 후보)

1. Agents Enabled (active / running / error / paused)  
2. Tasks In Progress  
3. Month Spend vs budget  
4. Pending Approvals  
5. Run activity / success rate 차트  
6. Recent activity + recent tasks 리스트  

## 기능 체크리스트 (카피캣 범위)

**Phase 0 — “회사가 돌아간다”**

- [ ] Company CRUD + 목표 + 회사 예산  
- [ ] Agent CRUD (CEO 온보딩, manager 링크)  
- [ ] Task CRUD + 상태머신 + assignee + checkout lock  
- [ ] Heartbeat 스케줄러 (이벤트 + optional timer)  
- [ ] **Hermes 어댑터 1종** (아래)  
- [ ] Run 목록 + 실패 transcript  
- [ ] Dashboard 요약 카드  

**Phase 1 — Paperclip “느낌”**

- [ ] Approvals (최소: hire, strategy)  
- [ ] Per-agent budget + pause at 100%  
- [ ] Inbox / Mine views  
- [ ] Comments on tasks  
- [ ] Routines (cron → issue → assign)  
- [ ] Activity feed  

**Phase 2 — 풀 제품에 가깝게**

- [ ] Skills + Skill Studio  
- [ ] Connections / MCP permissions (Allowed / Ask / Off)  
- [ ] Org chart UI  
- [ ] Artifacts, mobile, multi-company, export/import  
- [ ] Memory store (#460 계열) — 아래 갭 참고  

## Hermes 연동 (공식 Paperclip 기준)

**중요:** 공식 문서의 Hermes는 **`pip install hermes-agent`** (Nous Research Hermes Agent)이며, 어댑터 키는 `hermes_local` / `hermes_gateway`입니다.  
`hermes-acp`라는 별도 어댑터 이름은 문서 어댑터 표에 없음 (Hermes `provider` 값으로 `copilot-acp` 등은 있음).

### `hermes_local`

- 같은 머신에서 Hermes 프로세스 실행  
- `persistSession` + `--resume` → 하트비트 간 세션/메모리  
- `model`은 `provider/model` 또는 `~/.hermes/config.yaml`  
- Paperclip 스킬 + Hermes 스킬 병합  
- 프롬프트에 `PAPERCLIP_API_URL` / task context 주입 (adapter 책임)

### `hermes_gateway`

- 원격 Hermes API (`POST /v1/runs`, SSE events)  
- `X-Hermes-Session-Key`: `issue` | `agent` | `run` | `none` (기본 `issue` — 태스크 간 메모리 누수 방지)

### 어댑터 공통 계약 (overview)

1. 런타임 기동/호출  
2. company / task / wake context 전달  
3. 결과·세션·usage 수집  
4. 실행 전 환경 검증  
5. (선택) transcript 파서, skills sync  

**이 repo(loop)의 copycat:** UI·오케스트레이션은 Paperclip을 따르고, **유일한 Harness 타입 = Hermes** (`local` 또는 `gateway` 중 하나부터).

## 기억(Memory) 갭

- **#460** (열림): DB `agent_memories`, CRUD API, UI Memory 탭, heartbeat 시 top-N 주입 — **#461 PR은 머지 안 됨**  
- 이후 PR들: per-agent keyword memory (#3289), memory adapter framework + pre-run hydrate / post-run capture (#3250), learning journal 이슈 (#3326)  
- 카피캣 MVP에서 “Paperclip과 동일”을 주장하려면 **Run 사이 영속 기억**이 필수 차별점; Phase 0에서는 Hermes 자체 `--resume` + issue-scoped session key로 상당 부분 대체 가능

## 기술 스택 (원본)

- **Server:** Node.js (control plane API)  
- **UI:** React  
- **DB:** Postgres + Drizzle (마이그레이션/이슈·PR 서술 기준)  
- **CLI:** `paperclip` 명령 (설치·company·agent·budget 등)  

Copycat은 동일 스택을 쓰면 문서·API 레퍼런스를 그대로 재사용하기 쉽다.

## 전략 권고 (이 저장소)

| 접근 | 장점 | 단점 |
|------|------|------|
| **A. `paperclipai/paperclip` MIT 포크** | UI·API·heartbeat·예산·승인 이미 있음; Hermes만 남기고 나머지 어댑터 제거/숨김 | 대형 코드베이스, 브랜딩/라이선스 NOTICE |
| **B. 그린필드 + docs API 패리티** | `loop` repo 슬림 유지 | 6~12개월급 UI·스케줄러·감사 직접 구현 |

**Hermes-only copycat 목표라면 A가 압도적으로 빠름.**  
이 `loop` repo는 **제품 문서 + (선택) 얇은 Hermes 전용 포크 설정**을 두고, 앱 본체는 포크 레포 `rmngl/loop-app` 같은 **별도 트리**에 두는 현재 README 방침과도 맞음.

## 다음 문서/구현 산출물

1. ~~`docs/hermes-paperclip-mvp.md`~~ — **작성됨** (Phase 0 화면·API·하트비트)  
2. 포크 시: `ADAPTER_ALLOWLIST=hermes_local,hermes_gateway` 수준의 제품 플래그 스펙  
3. OpenAPI subset — MVP 문서 표 기준; 포크에서 실제 경로 검증  

## 참고 링크

- [Key concepts](https://docs.paperclip.ing/guides/welcome/key-concepts/)  
- [Dashboard](https://docs.paperclip.ing/guides/day-to-day/dashboard/)  
- [Agents guide](https://docs.paperclip.ing/guides/org/agents/)  
- [Issues & Inbox](https://docs.paperclip.ing/guides/day-to-day/issues/)  
- [Heartbeats & Routines](https://docs.paperclip.ing/guides/projects-workflow/routines/)  
- [Hermes adapter](https://docs.paperclip.ing/reference/adapters/hermes/)  
- [Hermes Gateway](https://docs.paperclip.ing/reference/adapters/hermes-gateway/)  
- [Adapters overview](https://docs.paperclip.ing/reference/adapters/overview/)  
- [Issue #460 — Persistent Memory](https://github.com/paperclipai/paperclip/issues/460)