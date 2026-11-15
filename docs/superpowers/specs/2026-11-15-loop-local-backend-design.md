# loop v1 — 로컬 백엔드: 커뮤니티를 묻지 않는 첫 실행

상태: 검토 대기 (승인 전 코드 없음)
날짜: 2026-11-15
범위: 프로젝트 (전체 설계)
관련: `2026-11-15-loop-skills-design.md` (스킬), `docs/buzz-without-an-account.md` (계정)

개정: rev 2 — 빌더 검증에서 나온 사실 오류 3건과 미해결 질문 7건을 반영했다.
그리고 다시 읽다가 찾은 설계 버그 2건을 고쳤다: 태그 색인(§6.8), 미디어 이음매 위치(§2).
rev 1 과 달라진 곳은 §2(이음매 6개·미디어 위치), §6.1(이름), §6.5(kind 7종),
§6.7(첫 실행), §6.8(태그 테이블), §6.10(소켓 모드), §7(M0b 추가), §12(질문과 답).

---

## 1. 무엇을, 왜

지금 loop를 처음 켜면 **"Join a community"** 가 뜨고 주소를 입력해야 합니다.
이름을 넣으면 `wss://<이름>` 으로 DNS 조회를 하다 실패합니다.

이유는 구조적입니다. 앱은 데이터를 저장하지 않습니다. 커뮤니티(=릴레이)가 유일한
저장소이고, 릴레이는 단순 저장소가 아니라 **서명 참여자**입니다. 채널 목록·권한·페이지
경계·멤버십 공지를 릴레이 키로 서명해서 내려줍니다.

그래서 목표는 "릴레이를 없앤다"가 아니라 **"사용자가 릴레이를 몰라도 되게 만든다"** 입니다.

1. 첫 실행에 커뮤니티 화면이 **없다**.
2. 데이터는 이 PC에 남는다. Docker도, Postgres도, Redis도, S3도, TLS 인증서도 없다.
3. 나중에 진짜 릴레이를 붙이면 **같은 클라이언트 코드가 그대로** 돈다.

---

## 2. 지난 답 정정

앞선 대화에서 "앱은 릴레이와 세 곳에서만 대화한다"고 했습니다. **틀렸습니다.
실제로는 여섯 곳이고, 그중 하나는 rev 1 에서도 놓쳤습니다.**

| # | 통로 | 실제 위치 | 무엇이 지나가나 | 필요 시점 |
|---|---|---|---|---|
| 1 | HTTP | `relay.rs:1030` `send()` | `/query`, `/events`, `/api/*`, 채널 명령 | M0 |
| 2 | 업로드 | `relay.rs:1640` `upload_file_authorized()` | Blossom `PUT /upload` | M3 |
| 3 | 미디어 | `media_blocks.rs:121` + `relay.rs:2388` | `GET /media/*` — Range 있는 읽기·없는 읽기 **두 곳** | M2 |
| 4 | **NIP-11** | `relay.rs:836` `relay_info()` | `GET /` — **`send()` 를 안 거친다** | M4 |
| 5 | 소켓 | `socket.rs:65` `relay_socket_connect()` | NIP-42 AUTH, REQ/EVENT/CLOSE/EOSE | M0 |
| 6 | **에이전트** | `app_agents.rs:1112,1523,1204,1332` | 에이전트 키로 `/query`, `/events`, `/upload`, `/media` | M2 |

**rev 1 의 오류 세 가지 — 전부 빌더 검증에서 잡혔다.** 그리고 그 검증을 다시 확인하다가
**네 번째**를 찾았다 (아래 오류 1 의 두 번째 문단).

**오류 1 — `media_request()` 는 이음매가 아니다.**
`relay.rs:2287` 은 `buzz-media://localhost/<인코딩된 URL>` 을 풀어 `(Url, Range)` 를
돌려주는 **순수 파서**다. 실제 송신은 `send_media()` (`:2413`)이고, 그 위에 두 진입점이
있다: `buzz-media` 커스텀 스킴(`fetch_media_bounded`)과 **`media_stream.rs` 의 루프백
HTTP 리스너**(`<video>`/`<audio>` 재생, `127.0.0.1` 바인딩, 256비트 토큰). 둘 다
`media_blocks::read` → `send_media` 로 모인다.

**다만 `send_media` 는 이음매가 될 수 없다.** 반환형이 `reqwest::Response` 인데
그 타입은 공개 생성자가 없어서(`reqwest 0.13.4` 에는 `From<http::Response>` 만 있고
`new`/`from_parts` 는 비공개) 로컬 백엔드가 가짜 응답을 만들 수 없다.

**이음매는 두 곳이고, 둘 다 `tauri::http::Response<Vec<u8>>` 를 돌려준다** —
바이트·상태·헤더를 그대로 만들 수 있다:

- `media_blocks::read()` (`media_blocks.rs:121`) — `Range` 가 있는 모든 읽기.
  `buzz-media`(`serve_blob`)와 `media_stream` 리스너가 **둘 다** 여기로 온다.
- `fetch_media_bounded()` (`relay.rs:2388`) — `Range` 가 **없는** 읽기
  (`serve_blob` 의 `None` 갈래, `:2329-2330`). `media_blocks::read` 를 거치지 않는다.

둘 다 **첫 줄에서 `evidence()` 를 부른다** (`media_blocks.rs:129`, `relay.rs:2393`).
그래서 이음매는 `evidence()` 보다 앞이어야 하고, 아니면 FI discovery 로 나간다.

**오류 2 — `relay_info()` 가 `send()` 를 완전히 우회한다.**
`relay.rs:836-857` 은 `client()?.get(url).send()` 를 직접 부른다. 호출자는
`channel_creation_supported()` (`:823`) 이고, 그건 다시 `relay_sign()` 안에서
**kind 9007 서명 시점에** 불린다 (`:285`). 즉 rev 1 대로 `send()` 첫 줄만 가로채면
**채널 생성이 첫 단계에서 `GET https://…/` 로 나가 실패한다.** `relay_admin/mod.rs:102`
도 같은 함수를 쓴다 (단, `relay_admin/net.rs:114-122` 가 `localhost`/`.local`/`.internal`
/`home.arpa`/`.lan` 을 이미 거부하므로 로컬 백엔드에서는 호출되지 않는다).

**오류 3 — `service.ts:345` 의 `localName` 은 이름을 만들어 주지 않는다.**
`:345` 는 `readLocalCommunityName()` 이고 **localStorage 만** 읽는다
(키 접두사 `buzz-community-name.v1:`, `names.ts:42-54`). 시드 경로(`:320-327`)는
`localName` 을 쓰지 않는다. 이름은 `communityName()` = `localName || publishedName || name`
(`names.ts:23-26`) 순으로 정해지고, 호스트명은 `communityDestination().name`
(`destination.ts:74-82`), `publishedName` 은 **NIP-11 의 `name`** 에서 온다
(`community-icon.ts:53-78` → `names.ts:17-20`, 단 문자열 `"Buzz Relay"` 는 버린다).

**따라서 이름은 NIP-11 `name` 으로 넣는다.** 코드 추가 0줄. 다만 `publishedName` 은
**비동기로 도착**한다 (`service.ts:365-418`, 실패하면 조용히 무시). 그 전까지 화면에는
호스트명이 보인다 — `loop.localhost` 가 잠깐 뜨는 것을 감수한다.

---

## 3. 접근과 선택

| 접근 | 하는 일 | 판정 |
|---|---|---|
| (가) 진짜 릴레이 띄우기 | `buzz-relay` + Postgres + Redis + MinIO + HTTPS | 코드 0줄이지만 Docker가 필수. 사용자는 여전히 주소를 입력 |
| (라-1) **Tauri 안 프로세스 내 백엔드** | 위 여섯 통로(일곱 지점)에서 가로채 SQLite로 답한다 | **선택** |
| (라-2) 루프백 HTTPS 서버 | 127.0.0.1에 진짜 서버를 띄운다 | TLS 인증서를 OS 저장소와 WebView2 양쪽에 심어야 함. 사용자 단계가 생김 |
| (다) 프론트 재작성 | `src/features/relay` 44,554줄 대체 | 포크 절반 |

**(라-1)을 고릅니다.** 소켓을 열지 않으므로 TLS·DNS·포트가 없고, 새 프로세스도 없습니다.
(라-2)는 "웹뷰가 직접 소켓을 연다"(`native-socket.ts:49` `new WebSocket(this.url)`)는
경로 때문에 자체 서명 인증서를 요구합니다. 그건 설치 안내문이 한 장 늘어나는 일입니다.

> 참고: `media_stream.rs` 는 **이미** 127.0.0.1 리스너를 띄운다. 그러나 그건 미디어
> 재생용이고 `Host`/`Origin`/토큰을 자체 검사하며 릴레이 계약을 말하지 않는다.
> 로컬 백엔드는 이 리스너를 재사용하지도, 새로 만들지도 않는다.

---

## 4. 목표 / 비목표 / 반목표

**목표**

- 첫 실행에 커뮤니티를 묻지 않고, 채널 하나에서 사람과 에이전트가 대화한다.
- 데이터는 `app_data_dir` 아래 SQLite 한 파일.
- 나중에 실제 릴레이 주소를 추가하면 같은 화면이 그대로 동작한다.

**비목표 (v0)**

- DM, Huddle(음성), 워크플로, 검색, Git, 아티팩트 동기화, 이모지 세트.
- 여러 기기 동기화. 로컬 백엔드는 이 PC에만 있다.
- 실제 릴레이와의 양방향 마이그레이션.

**반목표**

- 두 번째 제품이 되는 것. 로컬 백엔드는 **계약의 부분집합**이고, 그 이상을 만들지 않는다.
- 클라이언트에 "릴레이"라는 말이 노출되는 것.
- `packages/serve` 재작성. 무관하다.
- 로컬 모드 전용 화면·분기. 화면은 하나여야 한다.

---

## 5. 제약

- Rust. `src-tauri/` 안의 새 모듈 하나. 프론트엔드는 **한 줄도 고치지 않는다**
  (예외: §6.7 의 빌드 변수).
- **새 크레이트 없음.** 필요한 것은 이미 있다:
  `rusqlite 0.40 (bundled)`, `secp256k1 0.31`, `nostr 0.45.5`, `sha2`, `uuid`, `base64`,
  `serde_json`, `tokio (net, sync, time)`.
- `hyper` 는 **쓰지 않는다.** 소켓도 포트도 열지 않기 때문이다 (rev 1 은 근거 없이 넣었다).
- 기존 `archive` 모듈(`src-tauri/src/archive/store.rs`)이 이미 같은 방식으로 SQLite를 쓴다.
  그 패턴을 따른다.
- `LICENSE` / `NOTICE.md` 유지. 이름은 `loop`.

---

## 6. 설계

### 6.1 이름과 자리

| 항목 | 값 | 이유 |
|---|---|---|
| 커뮤니티 주소 | `https://loop.localhost` | RFC 6761 이 `.localhost` 를 루프백으로 예약. 놓친 이음매가 있으면 **인터넷이 아니라 127.0.0.1:443 으로 즉시 실패**한다 |
| 표시 이름 | **NIP-11 `name`** = "내 워크스페이스" | `publishedName` 경로 (`names.ts:17-26`). `localName` 아님 (§2 오류 3). 비동기로 도착하므로 첫 프레임은 호스트명 |
| DB | `app_data_dir()/local-backend/loop.sqlite3` | `archive/mod.rs:52-61` 과 같은 규칙 |
| 릴레이 키 | 32바이트, 최초 생성 후 DB에 보관 | `self` 가 재시작마다 바뀌면 클라이언트가 39000 을 신뢰하지 않는다 |

`relay.rs:63-77` 의 `origin()` 은 `https` 를 요구하고 `loop.localhost` 는 통과한다.
`destination.ts:3-6` `relayOrigin()` 정규식 `/^(?:wss|https):\/\/[^/?#\\\s@]+\/?$/i` 도
통과한다. `canonical_relay()` (`config.rs:301-315`) 는 80 포트를 거부하는데 해당 없음.

### 6.2 여섯 통로, 일곱 지점

미디어만 두 곳(3a/3b)이라 삽입 지점은 **일곱**이다.

```rust
// src-tauri/src/local_backend/mod.rs
pub(crate) fn handles(community: &str) -> bool;                 // origin 비교
pub(crate) async fn http(&self, viewer: &str, path: &str,
                         method: &str, body: Option<&str>) -> Result<RelayResponse>;
pub(crate) fn socket(&self, id: String, events: Channel<SocketEvent>) -> Option<SocketMode>;
pub(crate) async fn custody(&self, agent: &AppAgent, request: CustodyRequest)
    -> Result<CustodyReply>;
```

| # | 파일 | 삽입 지점 | 주의 |
|---|---|---|---|
| 1 | `relay.rs:1030` | `send()` 의 **첫 줄** | `evidence()` 보다 앞. FI discovery(`GET /info`)를 건너뛴다 |
| 2 | `relay.rs:1649` | `upload_file_authorized()` 첫 줄 | Blossom `Authorization` 검증은 로컬에서 직접 |
| 3a | `media_blocks.rs:121` | `media_blocks::read()` 첫 줄 | `Range` 있는 읽기. **`send_media` 가 아니다** — `reqwest::Response` 는 공개 생성자가 없다 |
| 3b | `relay.rs:2388` | `fetch_media_bounded()` 첫 줄 | `Range` **없는** 읽기 (`serve_blob` `:2329-2330`). `read()` 를 안 거친다 |
| 4 | `relay.rs:836` | `relay_info()` 첫 줄 | `send()` 를 안 거치는 유일한 HTTP. kind 9007 게이트 |
| 5 | `socket.rs:65` | `relay_socket_connect()` 첫 줄 | `upgrade()` 를 부르지 않는다. **모드 `Native` + `Sockets` 직접 등록** (§6.10) |
| 6 | `app_agents.rs:1112/1523/1204/1332` | `signed_read` / `post` / `upload` / `media` 앞 | 에이전트 키 서명 검증. URL 은 `agent-controller/src/app_agent.rs:143-158` |

5번이 `upgrade()` 안이 아니라 그 **앞**이어야 하는 이유: `upgrade()` 는 첫 줄에서
`assertion_for_socket()` → `discovery()` → `GET /info` 를 부른다. 그 전에 돌아서야 한다.

**에이전트의 신원은 앱이 관리한다.** `app_agent_query` 등은 `state.signer(pubkey, relay)`
(`app_agents.rs:165`)로 에이전트 키를 꺼내 서명하므로, 로컬 백엔드는 **이벤트의 `pubkey` 를
`relay` 별 에이전트 목록과 대조**하기만 하면 된다. 새 신뢰 모델이 필요 없다.

### 6.3 계약 — HTTP

`relay.rs:79-100` 의 `request_url()` 허용 목록이 곧 전체 목록이다.

| 경로 | 메서드 | 로컬 백엔드가 답할 것 | 근거 |
|---|---|---|---|
| `/` | GET | NIP-11 JSON. **`self` 64 hex 필수**, `name` | `native.ts:387-392,450` |
| `/info` | GET | 같은 JSON. **요청되지 않는다** — 이음매 1 이 `evidence()` 앞에서 돌아서므로 FI discovery 자체가 없다. 방어적으로만 답한다 | `assertion.rs:185`, `relay.rs:1041-1043` |
| `/query` | POST | 필터 배열 → 이벤트 배열. **`created_at` 내림차순, 동률이면 `id` 오름차순** | `store.ts:2140-2145` |
| `/events` | POST | `{"accepted":true,"event_id":"<id>","message":"<문자열>"}` | `transport.ts:1692-1710` |
| `/upload` | PUT | Blossom. `x` 태그 해시 검증 후 저장, BlobDescriptor 반환 | `relay.rs:1655-1680` |
| `/media/*` | GET | 바이트 + `Content-Type` + Range | `relay.rs:2344` |
| `/api/join-policy` | GET | `{"policy": null}` | `join-policy.ts:29-52` |
| `/api/invites*` | POST | 호출되지 않음. 도달하면 404 JSON | `join.ts` |

**`message` 는 반드시 문자열이어야 한다.** 없애면 `"Relay returned an invalid delivery
receipt"` 로 죽는다 (`transport.ts:1697-1710`). v0 는 `""` 를 돌려준다.

**`/api/join-policy` 는 `{"policy": null}` 이 정답이다.** `{}` 도 통과하지만
(`find-community.ts:68`, 404 도 "정책 없음"), 명시적인 쪽이 의도를 남긴다.

`/query` 가 받아야 하는 필터 필드 (`events.ts:16-50`):
`kinds`, `ids`, `authors`, `#h`, `#d`, `#p`, `#e`, `#a`, `#t`, `limit`, `since`, `until`,
`before_id`, `top_level`, `include_aux`, `include_summaries`, `consistency`.
v0 는 `search`·`search_sort`·`artifact`·`thread_*` 를 받으면 **빈 배열**로 답한다
(NIP-11 에 해당 확장을 광고하지 않으므로 클라이언트가 보내지 않는다).

#### NIP-11 문서에 무엇을 넣고 무엇을 빼는가

**NIP-11 은 기능 스위치다.** 필드를 빼면 그 기능이 꺼진다 — 로컬 전용 분기가 필요 없다.

| 필드 | v0 | 빼면 |
|---|---|---|
| `self` | **필수** (64 hex) | 연결 자체가 안 됨 (`native.ts:450`) |
| `name` | "내 워크스페이스" | 호스트명이 보임 (`names.ts:17-26`) |
| `supported_nips` | **`[29]` 없이** 시작, M4 에서 추가 | 9007 채널 생성 꺼짐 (`native.ts:451-452,970`) |
| `supported_extensions` | **비움** | `nip-cl`(채널 라벨)·`nip-ar`(아티팩트)·`buzz-search-sort` 전부 꺼짐 (`native.ts:453-465`) |
| `artifacts` | **없음** | 아티팩트 동기화 꺼짐 (`:466`) |
| `federated_identity` | **없음** | FI 어서션 없음 + **검증 프로필 배지 꺼짐** (`verified-profile.ts:45-47` 은 `undefined` 면 `null` = 기능 없음) |
| `read_state_snapshot` | **없음** | `readCommunity` 가 `undefined` → 스냅샷 경로 전부 생략 (`native.ts:475,914`) |
| `limitation.federated_identity` | **없음** | `discovery()` 가 "요구 안 함"으로 답함 (`assertion.rs:199-215`) |
| `public_profile` | **없음** | 인물 검색 배지 없음 |
| `admin_api` | **없음** | `relay_admin_discover` 가 `None` (`relay_admin/mod.rs:105-110`) |

**되도록 `limitation` 자체를 넣지 않는다.** `evaluate_discovery` 는 `limitation` 이
객체가 아니면 오류를 낸다 (`assertion.rs:200`). 빈 객체는 안전하지만 아예 없는 편이 낫다.

### 6.4 계약 — 웹소켓

| 프레임 | 로컬 백엔드 |
|---|---|
| 서버 → `["AUTH", "<challenge>"]` | 연결 직후 1회 |
| 클라 → `["AUTH", <kind 22242>]` | `relay` 태그 = `wss://loop.localhost`, `challenge` 태그 검증 |
| 서버 → `["OK", <id>, true, ""]` | 인증 확인. 이후에만 REQ 허용 |
| 클라 → `["REQ", sub, filter…]` | 매칭 이벤트를 최신순으로, 이어서 `["EOSE", sub]` |
| 클라 → `["EVENT", <event>]` | 저장 후 `["OK", id, accepted, msg]` |
| 클라 → `["CLOSE", sub]` | 구독 해제 |
| 서버 → `["EVENT", sub, <event>]` | 새 이벤트가 구독에 맞으면 push |

`live.ts` 는 **EOSE 를 받아야** 그 라우트를 살아있다고 본다 (`live.ts:178,1950`).
EOSE 를 빠뜨리면 채널이 영원히 로딩이다.

### 6.5 릴레이가 서명하는 이벤트 7종

클라이언트가 `pubkey === relayAuthor` 를 확인하는 곳을 전부 세면 **일곱**이다.
rev 1 의 "6종" 은 셋을 빠뜨렸다.

| kind | 무엇 | 필수 태그/본문 | 확인하는 곳 | v0 |
|---|---|---|---|---|
| **39000** | 채널 메타데이터 | `d`=채널 uuid, `t`=stream\|forum\|system, `name`, `about`, `visibility`, `public` 태그 | `discovery.ts:55`, `openMetadata` | **필수** |
| **39001** | 채널 관리자 | `d`=채널 id, `p`=관리자 | `channel-lifecycle-protocol.ts:139` | **필수** |
| **39002** | 채널 로스터 | `d`=채널 id, `p`=멤버 (4번째 = role) | `discovery.ts:262`, `:311` | **필수** |
| **39005** | 스레드 요약 | `e`=루트 id, 본문에 답글 수 | `message-projection.ts:98-100` | M3 |
| **39006** | 윈도우 경계 | `h`=채널 id, `d`=`<채널>:head` 또는 `<채널>:<until>:<before_id>`, 본문 `{has_more, next_cursor}` | `window.ts:52-105` | **필수** |
| **40099** | 멤버십 공지 | `h`=채널 id, 본문 `{type, actor, target}` | `membership.ts:23-43` | M2 |
| **13534** | 커뮤니티 로스터 | `["member", pubkey, "owner"\|"admin"\|"member"]` | `roster.ts:17-18` | **권장** |

**13534 를 넣는 이유.** `useCommunityRole` → `readRoster` 는 이벤트가 없으면 `null` 을
돌려주고(`roster.ts:47-59`), 그러면 role 이 `undefined` 가 되어 owner/admin UI 가 조용히
사라진다 (`useCommunityRole.ts:44-49`). 실패해도 화면이 안 죽어서 **거절 로그로는 안 잡힌다.**
같은 멤버 목록을 한 번 더 쓰는 비용이라 v0 에 넣는다.

**넣지 않는 것과 그 근거.**

- **13535** (아카이브 스냅샷) — `identity-archives.ts:110` 은 항상 읽지만
  `:120-123` 에서 **0건이면 "아무도 아카이브되지 않음"으로 정상 종료**한다.
  `/query` 가 빈 배열을 주면 끝. `"Invalid archive snapshot"` 은 1건 이상일 때만 난다.
- **44100/44101** (멤버십 힌트) — `session.ts:3721-3728` 이 `relayAuthor` 를 확인하지만
  이건 **힌트**다. 없으면 로스터 재조회로 확인된다 (`:3330-3372`).

**39000/39001/39002 셋 다 있어야** 채널 설정 화면이 열린다. 하나라도 없으면
`"Current channel permissions could not be verified"` 로 던진다
(`channel-lifecycle-protocol.ts:139-142`). 채널을 만들 때 셋을 한꺼번에 쓴다.

**39002 에는 뷰어 자신의 `p` 태그가 반드시 있어야 한다.** `canAccess` 는 `public` 태그로
열리지만(`discovery.ts:295-308`), **`canParticipate` 는 `hasTag(roster, "p", viewer)` 를
요구한다** (`:311-321`). 없으면 채널이 **보이는데 글을 못 쓴다.** M1 의 "사람이 글을 쓴다"가
바로 여기 걸린다. 시드 로스터에 사용자 pubkey 를 `member` 로 넣는다.

**39006 은 요청마다 정확히 하나**여야 한다. `parseWindow` 는 0개도 2개도 거부하고,
`has_more` 와 `next_cursor` 가 모순되면 또 거부하며, 커서가 전진하지 않아도 거부한다
(`window.ts:71-101`). 로컬 백엔드에서 가장 틀리기 쉬운 부분이다.

채널 id 는 **소문자 UUID** 여야 한다 (`channel_writes.rs:5-11` `uuid()`).

### 6.6 클라이언트 명령 → 릴레이 상태

클라이언트는 상태를 직접 쓰지 않는다. **명령을 보내고 릴레이가 상태를 다시 쓴다.**

| 클라 명령 | 릴레이가 할 일 | 어느 이음매 |
|---|---|---|
| `9007` 채널 생성 | uuid 생성 → 39000·39001·39002 → 40099 | 1 (`relay_http` 가 `creation()` 검증, `:934-943`) |
| `9002` 상세 변경 | 39000 새 버전 | 1 (`relay_channel_publish`) |
| `9000`/`9001` 멤버 추가·제거 | 39002 + 40099 | 1 |
| `9008` 채널 삭제 | 39000 에 `archived` | 1 |
| `9021`/`9022` 참여·떠남 | 39002 + 40099 | 1 |
| `9`, `40002`, `40008`, `7`, `40003` | 그대로 저장 | 1 |
| `5` | 그대로 저장. `39005` 재계산 | 1 |

`relay_http` 는 `/events` 로 `9002/9008/9021/9022/41012/9035/9036` 이 오면 **거부**한다
(`relay.rs:944-946`). 그건 `relay_channel_publish` 로 간다. 둘 다 이음매 1 이라 문제없다.

**v0 가 실제로 받게 될 쓰기 kind 목록** (`native.ts:94-113` `nativeWriteKinds`):
`48103, 30078, 7, 9, 1984, 30030, 30175, 30177, 30178, 30315, 40003, 40100, 42000, 45010`
(+ 워크플로 kinds, + 9000/9001). **추측하지 말고 이 목록을 기준으로 시작한다.**

검증 규칙은 `channel_writes.rs` 의 기존 함수를 **그대로 포팅**한다
(`creation()` 은 `visibility ∈ {open, private}`, `channel_type ∈ {stream, system}`,
이름 120자, about 1000자).

### 6.7 첫 실행 — 두 개의 문

rev 1 은 "빌드 변수 하나면 끝"이라고 했습니다. **틀렸습니다. 문이 두 개입니다.**

```
App.tsx:96-108   Welcome → LaunchSignIn → ConnectedApp
                       ↑ 여기서 신원 게이트가 먼저다
App.tsx:231-236  firstRun = client.memberships.length === 0  → CommunityLanding
```

| 문 | 조건 | rev 1 의 답 | 실제 |
|---|---|---|---|
| **문 1 — 커뮤니티** | `memberships.length === 0` | 빌드 변수로 해결 | **맞다.** `service.ts:320-327` 이 `else if (openRelay && stored === null)` 에서 시드한다 |
| **문 2 — 신원** | 키가 없으면 `Welcome` 이 랜딩을 띄운다 (`Welcome.tsx:367-381,1191-1204`) | 언급 없음 | **남는다.** 커뮤니티를 시드해도 "Create account / Sign in / Other options" 가 먼저 뜬다 |

문 2 를 그냥 두면 사용자는 `Other options` → **커뮤니티 주소 입력** → `ConnectChoice`
→ `Create a new key` 를 지난다 (`Welcome.tsx:1304,1389-1408`). 주소가 시드되어 있으면
DNS 실패는 없지만 **화면 3개**다. rev 1 의 "0번"은 틀렸다.

**그래서 M0b 를 추가한다: 첫 실행에 키가 없으면 자동 생성한다.**

- 근거: 로컬 백엔드는 이 PC 전용이고, 키가 없으면 앱이 아무것도 못 한다.
  `identity_create` (`identity.rs:1360-1368`)는 이미 있고 시그니처 변경이 필요 없다.
- 위치: `IdentityHost` 초기화 직후, 로컬 백엔드가 켜져 있을 때만.
- 대가: 사용자가 키를 만든 순간을 모른다. `BackupConsent`/`LinkedKeyCheck` 는 그대로
  동작하므로 백업 유도는 나중에 온다.
- **이건 제품 결정이라 승인이 필요하다** (§12 Q5).

부트스트랩이 없을 때의 정직한 측정 기준: **"커뮤니티 관련 화면 0번, 신원 화면 1번"**.

빌드 변수는 그대로 쓴다: `BUZZ_DEFAULT_COMMUNITY_URL=https://loop.localhost`
(`vite.config.ts:136-142` → `VITE_BUZZ_OPEN_RELAY`). 런타임 시드 경로를 하나 더 만들지
않는다 — **둘 다 하면 두 개의 진실이 생긴다.**

### 6.8 저장 스키마

```sql
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,        -- 64 hex
  pubkey     TEXT NOT NULL,
  kind       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  tags       TEXT NOT NULL,               -- JSON, 원본 그대로
  content    TEXT NOT NULL
);
CREATE INDEX events_page   ON events(kind, created_at DESC, id ASC);
CREATE INDEX events_author ON events(pubkey, kind, created_at DESC);

-- 태그 하나당 한 행. `#p`/`#e`/`#h`/`#d` 를 전부 색인한다.
CREATE TABLE event_tags (
  seq     INTEGER NOT NULL,               -- events.seq
  name    TEXT NOT NULL,                  -- "h" | "d" | "p" | "e" | "a" | "t"
  value   TEXT NOT NULL,
  extra   TEXT,                           -- 4번째 요소 (role, relay hint)
  ord     INTEGER NOT NULL,               -- 태그 순서
  PRIMARY KEY (seq, ord)
);
CREATE INDEX event_tags_lookup ON event_tags(name, value, seq);

CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- 릴레이 비밀키, 시드 완료
CREATE TABLE blobs (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
```

**첫 `p` 만 저장하면 안 된다.** 채널 발견은 로스터를
`{ kinds: [39002], "#p": [viewer] }` 로 읽는다 (`store.ts:2118-2123`). 로스터에는
`p` 태그가 여럿이고 **뷰어가 첫 번째라는 보장이 없다.** 첫 `p` 만 색인하면 이 질의가
0건을 돌려주고 **채널 목록이 영원히 비어 있다.** 그래서 태그 테이블이 필요하다.
rev 1 의 `p_tag TEXT` 한 칸 설계는 이 지점에서 틀렸다.

- WAL, `busy_timeout=2000`, `PRAGMA secure_delete=ON` — `archive/store.rs:29` 와 동일.
- 쓰기는 `Mutex<Connection>` 하나로 직렬화. 앱과 에이전트가 같은 파일을 쓴다.
- `before_id` 페이지네이션은 `(created_at, id)` 복합 커서. 인덱스가 그대로 먹는다.
- 이벤트 삭제(kind 5)는 `events` 행을 지우지 않고 `deleted` 표시를 둔다 — 교체 가능
  이벤트(39000·39002)의 옛 버전을 계속 참조할 수 있어서다.

### 6.9 실패는 크게

조용한 실패가 가장 위험합니다.

- `handles()` 가 참인데 처리기가 없는 경로는 **404 JSON** 을 돌려준다. 네트워크로 나가지 않는다.
- 처리하지 못한 kind 는 로그 한 줄을 남기고 `["OK", id, false, "unsupported kind <n>"]`.
- 로컬 주소로는 절대 밖에 나가지 않는다는 것을 테스트로 고정한다:
  `src-tauri` 의 모든 `reqwest`/`connect_async` 호출 지점을 세는 테스트.

### 6.10 소켓 모드 — 가장 조용한 함정

`socket.rs:106-111` 은 `upgrade()` 가 `Ok(None)` 을 돌려주면 **`SocketMode::Public`** 을
반환하고, 그러면 `native-socket.ts:48-50` 이 **웹뷰에서 `new WebSocket(this.url)` 을 직접
연다.** 그건 (라-2) 경로이고, `wss://loop.localhost` 로 TLS 핸드셰이크를 시도해 실패한다.

**따라서 이음매 5 는 `Native` 를 반환하고 프레임 루프를 직접 돌려야 한다.**
`relay_socket_start/send/close` 세 명령과 `Channel<SocketEvent>` 통로
(`socket.rs:39-57`, `:206-260`)를 그대로 쓰면 클라이언트는 진짜 소켓과 구별하지 못한다.

**다만 세 명령이 `Sockets` 맵을 직접 본다** — 그래서 이음매 5 는 반환 전에
`Connection { stop, sender, start: Some(oneshot) }` 을 **직접 등록**해야 한다:
`relay_socket_start` 는 `start.take()` 가 없으면 `"Native socket retired"`
(`:213-217`), `relay_socket_send` 는 항목이 없으면 같은 오류 (`:228-234`)다.
프레임 수신 루프는 그 `sender`(용량 16, `try_send`)를 비우면서 `Channel` 로 밀어낸다.
버퍼가 차면 클라이언트가 `"Socket send queue is full"` 을 받으므로, 루프는 즉시 소비한다.

### 6.11 계약 밖 트래픽 (문서화만)

| 무엇 | 어디 | v0 |
|---|---|---|
| 링크 미리보기·공개 이미지 | `host_request.rs:886`, `host_request/public_image.rs:163`, `public_page.rs:61` | 릴레이가 아니다. 실제 인터넷으로 나가도 무방 |
| 플러그인 패키지 | `packaged_plugins.rs:69` | 무관 |
| 프로젝트 Git | `relay/project_git.rs:403,487` — `git ls-remote` 를 **서브프로세스로** 실행 | **거부한다.** 자체 HTTP 클라이언트라 가로챌 수 없다 |
| 릴레이 관리 API | `relay_admin/mod.rs:102` | `net.rs:114-122` 가 `localhost`/`.local`/`.internal`/`home.arpa`/`.lan` 을 이미 거부 |

---

## 7. 마일스톤

| M | 내용 | 끝났다는 증거 |
|---|---|---|
| **M0** | 모듈 골격, 릴레이 키, DB, `handles()`, NIP-11(`self`+`name`, **`supported_nips` 에 29 없음**, 확장 전부 생략), 404 가드, 이음매 1·5 | 앱이 `https://loop.localhost` 로 부팅하고 커뮤니티 화면이 **안 뜬다**. 채널 목록은 비어 있다. 소켓이 `Native` 모드 |
| **M0b** | 첫 실행 키 자동 생성 (§6.7) | 새 프로필로 켜면 **신원 화면도 안 뜨고** 바로 셸 |
| **M1** | 시드 채널 1개(39000·39001·39002, **로스터에 뷰어 포함**), 13534, 메시지(9), 윈도우(39006), **`#p` 태그 질의** | 사람이 채널에 글을 쓰고, 새로 켜도 남아 있고, 위로 스크롤이 멈추지 않는다 |
| **M2** | 에이전트 턴: 이음매 6 + 3a, 거절 kind 로그, 프로필·타이핑·멘션 | 채널에서 `@에이전트` 가 답한다. **거절 로그가 빈 상태** |
| **M3** | 반응(7), 수정(5/40003), 업로드(이음매 2), **미디어 3b**, 스레드(39005) | 이미지가 붙고, 스레드 요약 숫자가 맞는다 |
| **M4** | 채널 생성(9007)·이름 변경(9002)·멤버(9000/9001)·삭제(9008). **NIP-11 에 `supported_nips: [29]` 추가** + `relay_info` 이음매(4) | 새 채널을 만들고, 이름을 바꾸고, 지운다 |

**M4 의 두 게이트는 같은 스위치다.** 클라이언트는 `supported_nips` 에 29 가 있어야
9007 을 보내고(`native.ts:451-452,970`), Rust 는 `channel_creation_supported()`
(`relay.rs:823-834`)가 같은 조건을 다시 확인한다. **광고하지 않으면 클라이언트도 안 보내고
Rust 도 안 물어본다** — 그래서 M0–M3 는 이음매 4 없이도 완결된다. 로컬 전용 분기가 아니라
**있는 것만 광고하는 것**이므로 §4 반목표와 충돌하지 않는다.

M0–M2 가 "loop가 된다"의 최소선입니다. M3–M4 는 그 다음입니다.

---

## 8. 측정

1. **M2 의 거절 로그.** 에이전트 한 턴에 앱이 실제로 쓰는 kind 집합을 처음으로 알게 된다.
2. **첫 실행 화면.** 새 프로필로 켜고, 커뮤니티 관련 화면이 **0번** 뜨는지.
   M0b 전이면 신원 화면 1번을 허용하고 그렇게 기록한다.
3. **재시작 보존.** 글 3개 → 종료 → 재실행 → 3개.
4. **계약 동일성.** 같은 테스트를 실제 릴레이와 로컬 백엔드 양쪽에 돌린다.
5. **소켓 모드.** 새 연결이 모두 `native` 인지 (한 번이라도 `public` 이면 TLS 로 샌다).

---

## 9. 위험

| 위험 | 왜 위험한가 | 대응 |
|---|---|---|
| 놓친 이음매 | 조용히 인터넷으로 나가거나 "연결 실패"만 뜬다 | 404 가드 + `reqwest` 호출 지점 개수 테스트. `.localhost` 라서 유출 불가 |
| **`p` 태그 색인 누락** | 채널 목록이 영원히 빈다 (§6.8) | 태그 테이블. `#p` 로스터 질의 테스트를 M0 에 |
| **소켓이 `public` 으로 떨어짐** | 웹뷰가 `wss://` TLS 를 시도하고 전부 실패 | §6.10. 모드 테스트 |
| **로스터에 뷰어 없음** | 채널이 보이는데 글을 못 씀 | 39002 에 뷰어 `p` 태그. M1 테스트 |
| **13534 누락** | owner/admin UI 가 조용히 사라짐 (에러 없음) | M1 에서 함께 작성 |
| 39006 경계 실수 | 채널이 영원히 로딩되거나 스크롤이 멈춘다 | 경계 계산 단위 테스트 먼저 |
| 두 작성자 | 앱과 에이전트가 동시에 쓴다 | WAL + `Mutex<Connection>` + `busy_timeout` |
| 릴레이 키 평문 | DB 파일을 읽으면 로컬 커뮤니티 키를 얻는다 | 사용자 키가 아니다. 문서에 명시 |
| 스키마가 굳는다 | 나중에 실제 릴레이로 옮길 때 안 맞는다 | 저장은 불투명 이벤트. 색인만 로컬 편의 |
| **키 자동 생성** | 사용자가 키 존재를 모른다 | M0b 는 승인 사항. `BackupConsent` 유지 |
| **이름이 늦게 온다** | 첫 프레임에 `loop.localhost` 가 보인다 | 감수. `service.ts:365-418` 이 조용히 갱신한다 |

---

## 10. 빌더에게 남기는 것

- 필터 엔진을 어디까지 일반화할지 (전체 태그 vs. `#h/#d/#p/#e/#a` 만).
- `40003`(수정) vs `5`(삭제) 처리 순서.
- 릴레이 키를 DB 에 둘지 `credential-service` 에 둘지.
- M2 로그를 파일로 남길지 개발자 설정 화면에 띄울지.
- 시드 채널 이름·기본 문구.
- `/api/invites*` 를 404 로 둘지, "초대 없이 가입" 응답을 만들지.
- `30078`(채널 레시피)·`40100`(Canvas)·`48103` 을 v0 에서 거부할지 저장만 할지.

---

## 11. 근거 (읽은 파일)

| 주장 | 파일:줄 |
|---|---|
| HTTP 단일 통로 | `src-tauri/src/relay.rs:1030` `send()`, `:904` `relay_http` |
| 경로 허용 목록 | `relay.rs:79-100` `request_url()` |
| **`relay_info` 우회** | `relay.rs:836-857`; 호출자 `:823`, `:285` |
| **미디어 실제 송신** | `relay.rs:2413` `send_media`; `media_blocks.rs:80` |
| **미디어 이음매가 `read()`+`fetch_media_bounded()` 인 이유** | `media_blocks.rs:121`, `relay.rs:2388,2329-2330` (반환 `tauri::http::Response`); `reqwest 0.13.4` `response.rs:451,480` 에 공개 생성자 없음 |
| 미디어 루프백 리스너 | `relay/media_stream.rs:6-20,68,315`; `lib.rs:1087` |
| 소켓 진입점·모드 | `socket.rs:65`, `:106-111`, `:206-260`; `native-socket.ts:39-70` |
| FI discovery 선행 호출 | `federated_identity/assertion.rs:185,363-381,391-407` |
| 에이전트 자체 통로 | `app_agents.rs:1078,1204,1332,1523,1112`; `agent-controller/src/app_agent.rs:143-158` |
| 에이전트 서명자 | `app_agents.rs:165-181` |
| `self`·29 필수 | `src/features/relay/native.ts:387-392,450-452,970` |
| NIP-11 기능 스위치 | `native.ts:453-475,914`; `verified-profile.ts:45-47`; `assertion.rs:199-215`; `relay_admin/mod.rs:105-110` |
| 쓰기 kind 목록 | `native.ts:94-113` |
| 영수증 모양 | `src/features/relay/transport.ts:1692-1710` |
| 39006 강제 | `src/features/relay/window.ts:22-105` |
| 서명 주체 7종 | `channel-lifecycle-protocol.ts:104-142`, `membership.ts:23`, `message-projection.ts:98`, `roster.ts:17-18` |
| 39002 뷰어 필수 | `src/features/relay/discovery.ts:295-321` |
| 로스터를 `#p` 로 읽음 | `src/features/relay/store.ts:2116-2128` |
| 13535 불필요 | `src/features/relay/identity-archives.ts:110,120-136` |
| 44100/44101 힌트 | `src/features/relay/session.ts:3721-3737,3330-3372` |
| 채널 id = uuid | `src-tauri/src/relay/channel_writes.rs:5-11` |
| 첫 실행 두 문 | `src/app/App.tsx:96-108,231-236`; `Welcome.tsx:367-381,1191-1204` |
| 시드 경로 | `src/features/communities/service.ts:320-327` |
| 이름 경로 | `names.ts:17-26,42-59`; `community-icon.ts:53-78`; `service.ts:365-418` (비동기 도착) |
| 빌드 변수 | `vite.config.ts:136-142,228` |
| 계약 밖 트래픽 | `host_request.rs:886`; `relay/project_git.rs:403,487`; `relay_admin/net.rs:114-122` |
| SQLite 선례 | `src-tauri/src/archive/store.rs:3,29`, `archive/mod.rs:52-61` |
| 기존 의존성 | `src-tauri/Cargo.toml:56,71,74,82` |

---

## 12. 빌더 검증에서 나온 질문과 답

rev 1 에 대한 검증에서 나온 7개 질문. **답을 정했고 위 본문에 반영했다.**

| # | 질문 | 답 | 본문 |
|---|---|---|---|
| 1 | `relay_info()` 우회로를 어떻게 막나 | **이음매 4 로 막는다.** 그리고 29 를 광고하지 않는 동안은 클라이언트가 9007 을 안 보내므로 M0–M3 는 무관 | §6.2, §7 |
| 2 | `media_stream` 루프백 리스너를 이음매로 보나 | **아니다.** `buzz-media` 와 리스너가 같은 두 함수로 모인다. 단 **`send_media` 는 쓸 수 없다**(공개 생성자 없음). 이음매는 `read()` + `fetch_media_bounded()` **두 곳** | §2, §6.2 |
| 3 | 서명 kind 가 6개인가 | **7개.** 13534 추가. 13535 는 0건이면 정상, 44100/44101 은 힌트라 불필요 | §6.5 |
| 4 | 39002 에 뷰어가 꼭 있어야 하나 | **필수.** `canParticipate` 가 `p` 태그를 요구한다. 없으면 읽기만 되고 쓰기 안 됨 | §6.5 |
| 5 | 신원 화면도 "0번"에 포함인가 | **포함이다.** M0b(키 자동 생성)를 추가했다. 승인 필요 | §6.7, §7 |
| 6 | DM 영수증의 `response:` 필드 | DM 은 비목표. `relay_direct_message` 는 404/거부. `message` 는 항상 문자열 | §6.3 |
| 7 | 에이전트가 Git 을 쓰나 | **쓴다** (`project_git.rs` 가 `git` 서브프로세스 실행). 가로챌 수 없으므로 v0 는 프로젝트 Git 을 **거부**한다 | §6.11 |
