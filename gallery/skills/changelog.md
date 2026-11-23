---
name: changelog
title.en: Changelog entry
title.ko: 변경 기록 (CHANGELOG)
summary.en: Adds user-facing release notes to CHANGELOG.md from commits since the last release.
summary.ko: 지난 릴리스 이후 커밋을 정리해 CHANGELOG.md에 사용자 관점의 변경 기록을 추가합니다.
description: Updates CHANGELOG.md with user-facing changes since the last release, grouped by type. Use when preparing a release or when the user asks for release notes.
---
# Changelog entry

1. Find the last release: the latest git tag (`git describe --tags --abbrev=0`) or the newest version heading in `CHANGELOG.md`.
2. List changes since then: `git log --oneline <last-tag>..HEAD`. Read commits or diffs when a message is unclear.
3. Keep only what users notice: features, fixes, behavior changes, deprecations, security fixes. Skip refactors, CI and test-only changes unless they affect users.
4. Follow the existing CHANGELOG format. If there is none, use Keep a Changelog style:
   `## [Unreleased]` with `### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Security`.
5. Write each entry as one plain sentence from the user's point of view. Call out breaking changes clearly with what users must do.
6. Show the new section before writing the file.
