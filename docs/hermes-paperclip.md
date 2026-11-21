# Hermes 위의 Paperclip

상태: 초안 (2026-11-22)  
범위: 이 저장소가 추구하는 유일한 제품 축

## 한 줄

**실행·모델·도구 = Hermes Agent.**  
**조직·스케줄·작업 큐·턴 사이 기억 = Paperclip에서 빌려오는 오케스트레이션 레이어** (Buzz/Pi/로컬 relay는 포함하지 않음).

## Hermes가 담당

- ACP 세션 (`hermes-acp`): 프롬프트, 도구, MCP, 워크스페이스
- 모델·자격: Hermes 설정 (`hermes model`, Hermes `auth.json`)
- Tier-2 외부 하네스 패턴: 앱/데몬은 Hermes를 띄우고 세션만 붙임

## Paperclip 레이어가 담당 (MVP 후보)

| 개념 | 역할 |
|------|------|
| **Heartbeat** | 주기적으로 “할 일”을 Hermes 턴에 넣음 |
| **Tickets / goals** | 상태·우선순위·소유 (DB 또는 파일) |
| **Persistent memory** | 하트비트 사이에도 유지되는 기억 (Paperclip #460 갭) |
| **Policy** | 예산·승인·도구 허용 |

## 비목표 (이 repo)

- Buzz 채널·멘션·relay를 코어로 두기
- 번들 Pi durable를 기본 LLM 경로로 두기
- `loop.localhost` / SQLite 로컬 백엔드 handoff 유지하기

## 조사 요약 (2026-11-22)

Paperclip은 이미 **제어판 UI + 하트비트 + 태스크 + 예산 + 승인**을 갖춘 **오픈소스(MIT)** 이고, 공식 **Hermes 어댑터**(`hermes_local`, `hermes_gateway`)가 있다.  
카피캣 = UI·기능 패리티를 Hermes 단일 런타임으로 좁히는 것. 상세 UI 맵·페이즈·어댑터 계약은 **`docs/paperclip-research.md`** 참고.

## 구현 문서

- **`docs/hermes-paperclip-mvp.md`** — Phase 0 화면/API·하트비트·수용 테스트 (Hermes only)
- **`docs/INITIAL_SETUP.md`** — 포크 초기 설정·Hermes 연결·T1–T5 체크

## 다음 결정

1. 구현 전략 확정: **Paperclip 포크(Hermes only)** (MVP 스펙 권장) vs 그린필드  
2. 앱 코드 레포 이름·포크 초기화 (`ADAPTER_ALLOWLIST`)