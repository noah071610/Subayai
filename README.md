https://www.npmjs.com/package/subayai — Ask your AI assistant to install and use this package.

# subayai

## Purpose

`subayai` is a Node.js command-line tool for processing image, SVG, and video files in the current project.

## AI operating contract

- Run commands non-interactively with `--json`; pass every required value as a flag.
- Before using `--all`, run the same command with `--dry-run --json` and inspect the planned input and output paths.
- Never pass `-y` / `--yes` unless the user explicitly asks to replace originals. Replacement archives originals under `.subayai/`.
- Do not enable the persistent `"subayai": { "replace": "always" }` setting unless the user explicitly asks.
- Preview `rename` with `--dry-run --json`; it renames files in place and does not archive them.
- Background removal and opaque-image background changes upload the selected image to iLoveAPI and consume API credits. Get user approval before using these commands; transparent PNG/WebP background changes reuse alpha and do not need the API.
- Treat SVG input as active content. The SVG-to-React component command optimizes markup but does not sanitize untrusted SVG; only generate/import components from trusted files.
- Do not start `sync --watch` unless requested; it runs until stopped.
- Keep `--json` stdout machine-readable. Exit codes: `0` success, `1` error, `2` all results skipped.

## Requirements

- Node.js `>=20.17`.
- `ffmpeg` and `ffprobe` for video processing.
- ImageMagick (`magick`) to convert PSD files.
- iLoveAPI public and secret keys for API-backed background removal. The first interactive use saves them to `~/.subayai/config.json` with owner-only permissions. In `--json` mode, configure the keys before running.

## Invocation

```sh
npx subayai <command> <file> [flags] --json
npx subayai <command> --all --dir <folder> [flags] --dry-run --json
npx subayai --help
```

`<file>` may be a path or a filename. A filename is searched in the configured `subayai.dir`, or up to three levels below the current directory. If multiple files match, pass a path. `--json` disables interactive prompts; missing values produce an error.

## Commands

| Command | Inputs | Required flags / behavior | Default output |
|---|---|---|---|
| `compress` | JPG, PNG, WebP, GIF, MP4, MOV, M4V | `--webp` converts images to WebP | `<name>_compress.<ext>`; videos output MP4 |
| `convert` | JPG, PNG, GIF, TIF/TIFF, PSD, SVG, WebP, MOV | `--to jpg\|png\|webp\|mp4`; optional `--bg <color>` for JPG | `<name>.<target>` |
| `edit` | JPG, PNG, WebP | One or more of `--brightness 0-2`, `--saturation 0-3`, `--radius <px>`, `--px <n>`; flags apply directly | `<name>_edited.<ext>` |
| `resize` | JPG, PNG, WebP | `--percent 1-99` or `--width <px>`; optional `--height <px>` for one file | `<name>_resized.<ext>` |
| `optimize` | JPG, PNG, WebP, SVG, MP4, MOV, M4V | Images accept resize flags; `--percent 100` keeps image dimensions | `<name>_optimized.webp`, `.svg`, or `.mp4` |
| `recolor` | PNG, WebP | `--color <hex\|rgba()\|name>` or `--gradient "<hex1>,<hex2>"` | `<name>_recolored.<ext>` |
| `svg recolor` | SVG | Optional `--color <color>` or `--gradient "<hex1>,<hex2>"` | `<name>_recolored.svg` |
| `svg responsive` | SVG | Removes width/height; retains or derives `viewBox` | `<name>_responsive.svg` |
| `component` | SVG folder | `--dir <folder>` and `--out <folder>` (saved `componentOut` can supply output) | `<out>/<input-folder>-graphics.tsx` or `.jsx` |
| `sync` | JPG, PNG, WebP, GIF, SVG, MP4, MOV, M4V | `--dir <source>` and `--out <output>` on first use; supports `--watch` after initial sync | Compressed mirror; PNG → WebP, MOV → MP4, other formats retained |
| `rename` | Files directly inside a folder, any type | `--dir <folder>`; interactive editor or natural filename order in non-interactive mode | Renames files in place; no new files |
| `removebg` | JPG, PNG, WebP | iLoveAPI keys required for opaque inputs | `<name>_nobg.png` or `.webp` |
| `changebg` | JPG, PNG, WebP | Optional `--color <hex\|rgba()>` or `--gradient "<hex1>,<hex2>"` | `<name>_bg.<ext>` |

Gradient colors must be two comma-separated hex values, for example `--gradient "#ff0000,#0000ff"`. A gradient cannot be combined with `--color`.

## Shared flags

| Flag | Meaning |
|---|---|
| `--all` | Process files directly inside the selected `--dir`; does not recurse into subfolders. `sync` is recursive. |
| `--dir <folder>` | Select an input folder; overrides saved folder configuration. |
| `--out <folder>` | Set an output folder for `component` or `sync`. |
| `--dry-run` | Print planned changes without writing outputs. |
| `--json` | Disable prompts and emit JSON results to stdout. |
| `-y`, `--yes` | Replace originals after archiving them under `.subayai/`. |
| `-h`, `--help` | Print command help. |

Processed output files are excluded from future selection. `--all` ignores subfolders and already-processed files. `resize --all` with `--width` cancels the whole batch if any image is narrower than the requested width; `--all` cannot combine `--width` and `--height`.

## Configuration

Project configuration lives in `package.json`:

```json
{
  "subayai": {
    "dir": "raw-images",
    "componentOut": "src/graphics",
    "sync": {
      "dir": "raw-images",
      "out": "public/images"
    }
  }
}
```

Only include settings that are needed. `dir` supplies the default image folder. `componentOut` supplies the SVG component output folder. `sync` stores the source and output folders after the first successful sync. `"replace": "always"` replaces originals on every applicable run and should only be set at the user's explicit request.

Global API keys and rename name suggestions are stored in `~/.subayai/config.json`, not in the project. Do not commit this file or copy its contents into project configuration.

## Output and data handling

- Normal processing writes a suffixed output next to the input and keeps the original.
- Replacement (`-y` / `--yes`) moves the original to `.subayai/<run-time>/` before writing the result under its original name.
- `sync` writes a mirrored output tree. It does not delete output files when source files are deleted.
- `rename` changes names in the selected folder in place; it does not archive the files.
- `--json` results contain `command`, `done`, `skipped`, `failed`, and per-file `results`. Errors may be returned as a top-level `error` object.
- iLoveAPI-backed operations send the image to the provider. Local image and SVG operations otherwise run on the local machine.

## Package contents

The published package exposes the `subayai` executable from `dist/cli.js` and includes `dist/` plus `skills/`. The bundled skill is `skills/subayai/SKILL.md`.

## License

MIT. See [LICENSE](LICENSE).
