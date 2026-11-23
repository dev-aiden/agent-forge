# Kitroom

## 한 줄 정의
이미 구독 중인 AI 코딩 도구(Claude Code·Codex CLI·Copilot CLI·Antigravity CLI)의 에이전트·스킬·규칙·MCP 설정을 한 화면에서 만들고 모든 도구에 적용한 뒤, 그 도구들을 한 창에서 띄워 쓰는 무료 오픈소스 데스크톱 앱 (macOS·Windows·Linux, MIT).
앱은 AI를 직접 호출하지 않는다. AI는 각 공식 CLI가 사용자의 구독으로 돌린다.

## 바뀌지 않는 원칙 (어기는 변경은 먼저 물어볼 것)
1. 앱은 AI를 직접 호출하지 않는다. 사용자는 기존 구독만으로 쓴다.
2. 사용자의 로그인·토큰·인증 파일에 손대지 않는다.
3. 모든 도구는 `packages/model` 공통 데이터 구조로 연결하고, 새 도구는 어댑터 추가로만 붙인다.
4. 사용자 파일은 미리보기와 백업 없이 바꾸지 않는다.
5. 사용자 컴퓨터 안에서만 돈다. 자체 서버·계정을 만들지 않는다.

## 스택과 폴더 구조
- 앱: Electron + electron-builder (TypeScript)
- UI: React + Vite + Tailwind (`apps/desktop/renderer`)
- 메인 프로세스: 설정 파일 읽기·쓰기, 파일 감시(chokidar), pty (`apps/desktop/main`)
- `packages/model`: 에이전트·스킬·규칙·MCP의 공통 데이터 구조
- `packages/adapters`: 도구별 설정 읽기·쓰기 (`claude`, `codex`, `copilot`, `antigravity`). 도구마다 파일 하나로 분리
  - rulesync를 라이브러리로 쓸 수 있으면 변환은 rulesync에 맡기고, 어댑터는 얇게 유지한다
- 실행 창: xterm.js(화면) + node-pty(프로세스)
- 저장: `~/.kitroom/` — 앱이 관리하는 에이전트·스킬 원본, 적용 전 백업
- `gallery/`: 기본 템플릿
- 배포: GitHub Releases(dmg·exe·AppImage) + Homebrew cask, electron-updater, GitHub Actions에서 OS별 빌드

## 데이터 출처와 규칙
- AI API를 호출하지 않는다. API 키 입력 화면도 만들지 않는다.
- 각 CLI의 로그인·토큰·인증 파일은 읽지도, 복사하지도, 다른 곳으로 보내지도 않는다. 실행 창은 공식 CLI 바이너리를 그대로 띄울 뿐이다.
- 사용자 설정 파일에 쓰기 전에는 반드시 diff를 보여주고, `~/.kitroom/backups/`에 원본을 백업한다. 되돌리기를 항상 제공한다.
- 도구별 경로·형식은 `packages/adapters/<tool>/paths.ts` 한 곳에 모은다. 하드코딩을 흩뿌리지 않는다.
- 감지되지 않은 도구는 화면에서 숨긴다. 지원 도구 목록은 설정에서 끄고 켤 수 있게 한다.
- 렌더러는 Node 접근 없이(contextIsolation) preload로 노출한 API만 쓴다.

## 설계 결정 (바꾸기 전에 이유를 확인할 것)

### 쓰기 파이프라인 (`packages/adapters/write/`)
- 흐름: 앱 원본(`~/.kitroom/source`) → rulesync를 **임시 홈을 가리키는 별도 프로세스**에서 실행 → 결과를 실제 파일과 비교한 미리보기 → 백업 → 적용 → 되돌리기
- 쓰기 허용 폴더·파일을 제한한다(`assertWritable`). 미리보기 이후 바뀐 파일이 있으면 적용 거부, 되돌리기는 사용자가 고친 파일을 건드리지 않는다
- 형식만 다른 마크다운(frontmatter 값·본문이 같음)은 `unchanged`로 보고 원래 파일 유지 (`sameMarkdown`)
- 파이프라인은 텍스트 파일만 다룬다 (바이너리는 깨지므로 가져오지 않음)

### 도구별 출력
| | 전역 | 프로젝트 |
|---|---|---|
| 에이전트 | `~/.claude/agents/*.md`, `~/.codex/agents/*.toml` | `.claude/agents`, `.codex/agents` |
| 스킬 | `~/.claude/skills/<이름>/`, `~/.agents/skills/<이름>/` | `.claude/skills`, `.agents/skills` |
| 규칙 | `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` | `CLAUDE.md`, `AGENTS.md` |
| MCP | Claude: 공식 CLI `claude mcp add-json - -s user`/`remove` (`~/.claude.json` 직접 쓰기 금지), Codex: `config.toml`의 MCP 부분만 | `.mcp.json`(파일로 직접), `.codex/config.toml` |

- claude.ai 동기화 스킬(`~/.claude/skills/synced`)은 쓰기 금지, 이름 `synced` 예약
- Codex `config.toml`·`.mcp.json`은 실제 파일을 스테이징에 복사해 다른 키를 보존
- `~/.codex/AGENTS.override.md`가 있으면 미리보기에서 경고 (Codex가 AGENTS.md 대신 읽음)
- Claude Code 세션 안에서 실행된 앱은 전역 Claude MCP 변경을 막는다 (Claude Code가 세션 안 stdin 추가를 거부하므로 우회하지 않음)

### 가져오기와 보존
- 처음에 기존 설정을 가져와 합친다: `importAgents`/`importSkills`/`importRule`/`importMcp` (`write/import.ts`). 가져온 직후 적용은 "이미 최신"이어야 한다 — 테스트로 확인
- 화면에 없는 필드는 읽기 전용으로 보존: 에이전트 `claudeExtra`·`codexExtra`, 스킬 `extra`(rulesync 형식: 최상위 키 + `claudecode` 섹션)와 묶음 파일, MCP `codexExtra`. 렌더러는 이 값을 보내지 않고, 저장할 때 저장된 값을 유지한다
- 가져오지 않는 것: 파일·폴더 이름과 `name`이 다른 에이전트·스킬(중복 생성), rulesync가 다시 쓰지 못하는 frontmatter가 있는 스킬(`SKILL_KEYS`, 예: Codex 스킬의 `license`), 바이너리·링크·200개/20MB 초과, Codex `agents/openai.yaml`, 옛 위치 `~/.codex/skills`, claude.ai 동기화 스킬
- 실제 공개 모음(anthropics/skills, wshobson/agents, VoltAgent 서브에이전트 400여 개)으로 가져오기 → 미리보기가 전부 `unchanged`인 것을 확인함. 가져오기 규칙을 바꾸면 같은 방식으로 다시 확인할 것
- 명시적인 빈 `tools: []`(도구 없음)는 생략(모든 도구)과 다르므로 `claudeExtra`로 보존
- 같은 이름이 두 도구에서 다르면 Claude Code 쪽을 가져오고 알린다

### 비밀값
- MCP의 env·headers·인자·URL 쿼리는 렌더러로 보낼 때 가린다. 가려진 값을 그대로 저장하면 원래 값 유지
- 원본 `mcp.jsonc`와 백업은 0600. 프로젝트 `.mcp.json`에 값이 그대로 들어가면 미리보기에서 경고

### 프로젝트 단위 쓰기
- 원본은 `~/.kitroom/projects/<이름-해시>/`(내 컴퓨터에만), 결과 파일만 프로젝트 안에 생긴다
- 렌더러는 "전역/이 프로젝트"만 고르고 실제 폴더는 메인 프로세스가 정한다. 홈 폴더·그 상위·`~/.kitroom`는 프로젝트로 거부

### 템플릿 (`gallery/`)
- `gallery/{agents,skills,rules,mcp}/` 마크다운(평평한 `key: value` frontmatter)·JSON. 파서는 `packages/model/gallery.ts`, 렌더러가 빌드 때 `import.meta.glob`으로 포함 (IPC·파일 읽기 없음)
- 입력란만 채운다(저장·적용은 사용자가). 규칙은 끝에 덧붙이기만. 지시문은 영어, 제목·소개는 한국어/영어
- 비밀값 금지(MCP env·headers는 `${VAR}`만) — `npm test`가 검사. Codex가 `${VAR}` 헤더를 풀지 않으므로 토큰이 필요한 MCP 템플릿은 넣지 않는다

### 네트워크
- 유일한 네트워크 요청은 새 버전 확인(`main/update.ts`: GitHub `/releases/latest`만, 설정에서 끔). 다른 정보는 보내지 않고 자동 설치하지 않는다. 스모크 테스트 중에는 요청하지 않음

### 실행 창과 빌드
- 터미널: xterm.js + node-pty. node-pty는 prebuild(macOS arm64·x64, Windows) 사용, Linux는 설치 시 빌드. macOS `spawn-helper` 실행 권한은 루트 `postinstall`(`scripts/fix-node-pty.mjs`)이 복구
- 로그인 셸의 PATH를 가져와 CLI를 찾는다
- CI(`.github/workflows/desktop.yml`): macOS·Windows·Linux 패키지 앱 스모크 테스트(rulesync 워커와 pty 실행까지). Intel Mac은 Rosetta로 참고용 확인
- 아직 코드 서명 없음

### 확인 필요
- Copilot·Antigravity 경로와 Codex 에이전트 폴더는 공식 문서로 확인했다(2026-11). 실제 설치로는 써 보지 않았다. 공식 문서에 없는 경로는 `paths.ts`에 "unverified path"를 달고 `verified: false`로 읽는다(화면에 `미확인 경로` 배지)
- Copilot `providers.json`(API 키 평문)·`config.json`, Antigravity `mcp_oauth_tokens.json`은 민감 파일로 읽지 않는다

## 작업 방식
- 사용자 설정 파일을 건드리는 코드는 테스트용 임시 폴더(가짜 HOME)에서 먼저 검증한다
- 변경 후 실행해서 확인한다 (`npm test`, `npm run typecheck`, 필요하면 앱을 띄워 확인)
- 커밋 메시지는 한국어. README·코드 주석·`docs/usage.md`는 영어, `docs/ko/`는 한국어
- 커밋 작성자 이메일은 GitHub noreply 주소
- 사용자 문서: `docs/usage.md`, `docs/ko/사용법.md` — 화면 문구가 바뀌면 함께 고친다

## 하지 않을 것
- AI 직접 호출, API 키 입력
- 구독 로그인·토큰을 대신 다루거나 다른 앱으로 넘기는 기능
- 터미널 렌더링 엔진 자체 개발 (xterm.js 사용)
- 클라우드 동기화, 회원 가입, 자체 서버
- 병렬 실행·worktree 관리를 v0.1 핵심으로 키우는 것 (P1 이후)
