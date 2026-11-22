# Agent Forge

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
- 저장: `~/.agent-forge/` — 앱이 관리하는 에이전트·스킬 원본, 적용 전 백업
- `gallery/`: 기본 템플릿
- 배포: GitHub Releases(dmg·exe·AppImage) + Homebrew cask, electron-updater, GitHub Actions에서 OS별 빌드

## 데이터 출처와 규칙
- AI API를 호출하지 않는다. API 키 입력 화면도 만들지 않는다.
- 각 CLI의 로그인·토큰·인증 파일은 읽지도, 복사하지도, 다른 곳으로 보내지도 않는다. 실행 창은 공식 CLI 바이너리를 그대로 띄울 뿐이다.
- 사용자 설정 파일에 쓰기 전에는 반드시 diff를 보여주고, `~/.agent-forge/backups/`에 원본을 백업한다. 되돌리기를 항상 제공한다.
- 도구별 경로·형식은 `packages/adapters/<tool>/paths.ts` 한 곳에 모은다. 하드코딩을 흩뿌리지 않는다.
- 감지되지 않은 도구는 화면에서 숨긴다. 지원 도구 목록은 설정에서 끄고 켤 수 있게 한다.
- 렌더러는 Node 접근 없이(contextIsolation) preload로 노출한 API만 쓴다.

## 현재 단계와 다음 작업
- 지금: 3주차 — 첫 쓰기 기능. 에이전트를 앱에서 만들어 Claude Code·Codex 전역에 적용 (미리보기 → 백업 → 적용 → 되돌리기)
  - 쓰기 경로: `packages/adapters/write/` (rulesync는 임시 홈을 가리키는 별도 프로세스에서만 실행, 쓰기 허용 폴더 제한)
  - 다음 후보: 스킬 쓰기 → 규칙·MCP 쓰기(rulesync가 MCP 목록·최상위 규칙을 통째로 교체하므로 기존 내용 가져와 합치기 필요, `~/.claude.json` 쓰기는 원칙 2 관련 결정 필요)
- 2주차 완료: 공통 데이터 구조(`packages/model`), Claude Code·Codex 읽기 어댑터, 설정 한눈에 보기 화면, 파일 감시 자동 갱신
- 1주차 완료:
  - `npm run scan` — 4개 도구 설정 경로·형식 스캐너 (`packages/adapters/scripts/scan.ts`)
  - rulesync 조사 — `docs/ko/rulesync-research.md` (MIT, 라이브러리 사용 가능. 임시 폴더 생성 → diff → 백업 후 적용 방식으로 감싼다)
  - Electron 빈 앱 — `apps/desktop`, CI(`.github/workflows/desktop.yml`)에서 macOS·Windows·Linux 패키지 앱 스모크 테스트 통과
- 확인 필요: Codex·Copilot·Antigravity는 이 컴퓨터에 설치되어 있지 않아 경로를 가짜 파일로만 검증했다 (`paths.ts`의 "unverified path")
- 저장소: https://github.com/dev-aiden/agent-forge (공개). 커밋 작성자 이메일은 GitHub noreply 주소를 쓴다

## 작업 방식
- 기능 하나씩, 플랜을 먼저 보여주고 승인 후 구현
- 변경 후 실행해서 확인, 커밋 메시지는 한국어로
- 사용자 설정 파일을 건드리는 코드는 테스트용 임시 폴더에서 먼저 검증한다
- 텔레그램으로 지시를 받을 때는 답을 짧게 요약하고, 커밋 전에 바뀐 파일 목록을 먼저 보여준다
- UI는 화면 시안(에이전트 만들기 화면)을 기준으로 맞춘다
- README·코드 주석은 영어, 문서 `docs/ko/`는 한국어

## 하지 않을 것
- AI 직접 호출, API 키 입력
- 구독 로그인·토큰을 대신 다루거나 다른 앱으로 넘기는 기능
- 터미널 렌더링 엔진 자체 개발 (xterm.js 사용)
- 클라우드 동기화, 회원 가입, 자체 서버
- 병렬 실행·worktree 관리를 v0.1 핵심으로 키우는 것 (P1 이후)
