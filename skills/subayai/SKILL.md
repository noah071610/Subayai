---
name: subayai
description: Use only when directly processing image, SVG, or video files with subayai (compress, convert, resize, edit, recolor, remove backgrounds, rename, sync, SVG components). Exclude UI design, image generation, code review, and incidental media mentions.
---

# subayai

Run `npx subayai <command> <file> [flags] --json`; folder commands use `--dir` (and `--out` when needed). Pass every value as a flag: `--json` disables prompts.

If asked to install it locally, use `npm install subayai`; otherwise `npx` is enough.

Use only flags supported by the chosen command; unsupported flags fail.

Examples: `npx subayai resize ./image.png --width 1200 --json`; `npx subayai compress --all --dir ./images --dry-run --json`; `npx subayai rename --dir ./images --dry-run --json`.

Commands: `compress`, `convert --to`, `edit`, `resize`, `optimize`, `recolor`, `svg recolor`, `svg responsive`, `component`, `sync`, `rename`, `removebg`, `changebg`. Gradient flags take two comma-separated hex colors, e.g. `--gradient "#ff0000,#0000ff"`.

- Preview `--all` and `rename` with `--dry-run --json`. `--all` scans one folder level; `sync` recurses.
- Never use `-y`/`--yes` or set `subayai.replace="always"` without an explicit request. Replacement archives originals in `.subayai/`; `rename` changes names in place.
- `removebg` uploads files to iLoveAPI; `changebg` uploads opaque inputs. Both use credits. Ask before uploading only if not already authorized; keys live in `~/.subayai/config.json`.
- Start `sync --watch` only on request. If `subayai.sync` is configured, use assets from `sync.out` (`.png` → `.webp`, `.mov` → `.mp4`).
- For SVG components, reuse existing `*-graphics.tsx`/`.jsx` exports; run `component` only when requested. Use trusted SVG files: conversion does not sanitize them.
- Exit codes: `0` success, `1` error, `2` all skipped.
