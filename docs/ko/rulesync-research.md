# rulesync 라이브러리 사용 가능성 조사

조사일: 2026-11-22 · 대상 버전: rulesync 43.11.0

## 결론

라이브러리로 쓸 수 있다. 다만 rulesync가 사용자 파일에 바로 쓰게 두지 않고,
**임시 폴더에 생성 → 실제 파일과 diff → 사용자 승인 → 백업 후 우리가 복사**하는 방식으로 감싼다.
이렇게 하면 "미리보기와 백업 없이 사용자 파일을 바꾸지 않는다"는 원칙을 지킬 수 있다.

## 라이선스

- MIT (Copyright (c) 2024 dyoshikawa). 우리 앱(MIT)과 호환된다.
- 배포물에 라이선스 고지를 포함하면 된다.

## 프로그램 API

`import { generate, importFromTool, convertFromTool } from "rulesync"` — ESM·CJS 모두 지원, 타입 정의 포함.

| 함수 | 하는 일 | 주요 옵션 | 쓰기 없이 실행 |
|---|---|---|---|
| `generate` | `.rulesync/` 원본 → 각 도구 설정 파일 생성 | `targets`, `features`, `inputRoots`, `outputRoots`, `global`, `delete` | `dryRun`, `check` |
| `importFromTool` | 도구 설정 → `.rulesync/` 원본으로 가져오기 | `target`, `features`, `global` | 없음 (항상 `.rulesync/`에 씀) |
| `convertFromTool` | 도구 A 설정 → 도구 B 설정으로 바로 변환 | `from`, `to`, `features`, `global` | `dryRun` |

- 결과 객체로 기능별 생성 파일 경로(`rulesPaths`, `mcpPaths` …), 삭제될 경로, 공유 설정 파일에서 바뀌는 키 목록을 돌려준다.
- 문서에 API 안정성 표시(stable/experimental)는 없다.

## 지원 대상 (우리 4개 도구)

| 도구 | target 값 | 규칙 | MCP | 명령 | 서브에이전트 | 스킬 | 훅 | 권한 |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Claude Code | `claudecode` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Codex CLI | `codexcli` | ✅ | ✅ | 전역만 | ✅ | ✅ | ✅ | ✅ |
| Copilot CLI | `copilotcli` | ✅ | ✅ | ✗ | ✅ | ✅ | ✅ | ✅ |
| Antigravity CLI | `antigravity-cli` | ✅ | ✅ | ✅(스킬로 생성) | ✅ | ✅ | ✅ | 전역만 |

## 제약과 대응

1. **결과를 메모리로 돌려주지 않는다.** 변환 결과는 항상 파일로 쓴다.
   → 임시 폴더를 출력 위치로 지정해 생성한 뒤 그 파일을 읽어 diff를 만든다.
2. **전역(`~`) 경로를 임시 폴더로 돌릴 수 있다.** `getHomeDirectory()`가 `HOME_DIR` 환경변수를 먼저 본다.
   프로젝트 경로는 `inputRoots`/`outputRoots`로 지정한다.
   → `HOME_DIR`은 프로세스 전역 값이므로 메인 프로세스가 아니라 별도 자식 프로세스(utilityProcess)에서 실행한다.
3. **`importFromTool`에는 dryRun이 없고 현재 폴더 기준으로 동작한다.**
   → 자식 프로세스의 cwd를 임시 폴더로 두고 실행한다.
4. **버전이 매우 빠르게 오른다** (메이저 43). → 정확한 버전으로 고정하고, 어댑터 테스트로 동작 변화를 잡는다.
5. **Node 22.22 이상 필요.** Electron 45는 Node 24.22를 포함하므로 충족한다.
6. **의존성이 무겁다** (`@octokit/rest`, `@modelcontextprotocol/sdk`, chokidar 6 등). 메인 프로세스에서만 쓰지만 앱 용량에 반영된다.

## 확인이 더 필요한 것

- Codex·Copilot의 권한 파일 경로, Codex 서브에이전트 경로는 문서에 명시가 없다. 실제 설치 환경에서 `npm run scan`으로 대조한다.
- rulesync가 공유 설정 파일(`~/.claude/settings.json`, `~/.claude.json`, `~/.codex/config.toml`)을 병합할 때 우리가 소유하지 않은 키를 건드리지 않는지, 임시 폴더에서 실험으로 확인한다.
- `~/.claude.json`처럼 인증 정보가 같은 파일에 들어 있는 경우, rulesync가 그 파일을 읽고 쓰는 범위를 확인한다 (원칙 2).
