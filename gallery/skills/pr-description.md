---
name: pr-description
title.en: Pull request description
title.ko: PR 설명
summary.en: Drafts a pull request title and description from the branch's commits and diff.
summary.ko: 브랜치의 커밋과 변경 내용을 보고 PR 제목과 설명을 작성합니다.
description: Drafts a pull request title and description from the current branch's commits and diff. Use when the user is about to open a pull request.
---
# Pull request description

1. Find the base branch (usually `main` or `master`) and run `git log --oneline <base>..HEAD` and `git diff <base>...HEAD --stat`, then read the important parts of the diff.
2. If the repository has a PR template (`.github/pull_request_template.md` or similar), fill it in instead of using the format below.
3. Otherwise write:
   - **Title**: short, describes the outcome.
   - **Summary**: what changed and why, in 2–5 bullets.
   - **How to test**: concrete steps or commands a reviewer can run.
   - **Notes**: risks, follow-ups, screenshots needed, breaking changes. Omit if none.
4. Describe only what is in the diff. Do not invent motivation; ask if the reason is unclear.
5. Show the draft. Create the pull request only if the user asked you to.
