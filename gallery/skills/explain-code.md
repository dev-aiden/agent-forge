---
name: explain-code
title.en: Explain code
title.ko: 코드 설명
summary.en: Explains how a file, function or feature works, with a short overview first and details after.
summary.ko: 파일, 함수, 기능이 어떻게 동작하는지 큰 그림부터 차근차근 설명합니다.
description: Explains how a piece of code or a feature works, tracing the flow through the codebase. Use when the user asks how something works or is new to the code.
---
# Explain code

1. Find the code the user means. If it is a feature, locate the entry point (route, command, UI handler) and follow the flow.
2. Start with a 2–3 sentence overview: what it does and where it fits in the project.
3. Then walk through the flow step by step, referencing `file:line` for each step. Explain why, not only what.
4. Point out non-obvious parts: side effects, error handling, performance traps, surprising conventions.
5. Use a small diagram or example input/output when it helps.
6. Match the user's level. Define terms a newcomer would not know. Keep it as short as the question allows.
7. Do not change any files.
