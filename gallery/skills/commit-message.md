---
name: commit-message
title.en: Commit message
title.ko: 커밋 메시지
summary.en: Writes a clear commit message from the staged changes, following the repo's existing style.
summary.ko: 스테이징된 변경을 보고 저장소의 기존 스타일에 맞는 커밋 메시지를 씁니다.
description: Writes a commit message for the staged changes that follows the repository's existing conventions. Use when the user asks to commit or to write a commit message.
---
# Commit message

1. Run `git diff --staged`. If nothing is staged, tell the user and show `git status` instead of guessing.
2. Run `git log --oneline -15` and follow the existing style: language, prefixes (e.g. `feat:`, `fix:`), capitalization, length.
3. Write the message:
   - Subject: one line, about 50–72 characters, says what changed and why it matters. No trailing period.
   - Body (only if useful): why the change was made, important details, and anything reviewers should check. Wrap at about 72 characters.
   - Mention issue numbers only if they appear in the branch name or the user gave them.
4. If the staged changes mix unrelated work, suggest splitting them into separate commits.
5. Show the message to the user. Commit only if they asked you to commit.
