# Youwee Operon Edition (desktop-operon)

The **Youwee downloader core, ported to the [Operon](https://github.com/WasewaseX/operon-lang-dev)
language**: a real native desktop window (egui) whose entire decision logic
is an operon program — no localhost server, no browser tab, no Python
launcher, and an **aria2-only bundle under 30 MB**.

This lane lives next to the (unchanged) Tauri application so upstream syncs
stay trivial; it shares Youwee's UX surface, not its process model.

```
┌────────────────────────────────────────────────────────┐
│  youwee-operon.exe (egui native window)                 │
│                                                        │
│  BODY (Rust host)              BRAIN (operon app.op)   │
│  ├─ window + widgets    ←──→   ├─ URL validation       │
│  ├─ child supervision          ├─ yt-dlp argv building │
│  │  (no timeout: real          │   (audio, subs,       │
│  │   desktop apps own          │    SponsorBlock,      │
│  │   long children)            │    speed, playlists)  │
│  │                             ├─ progress parsing     │
│  └─ aria2 extraction           ├─ job state machine    │
│                                ├─ settings + history   │
│                                └─ tool + theme state   │
│                                                        │
│  embedded operon interpreter (VM lane, capability      │
│  sandbox: default-deny, exact grants)                  │
└────────────────────────────────────────────────────────┘
        │ spawns                     │ runs
        ▼                            ▼
  yt-dlp (your PATH)          op/app.op
  ffmpeg (your PATH)          (extracted to app data)
  aria2c  (BUNDLED)
```

## Youwee features ported into the operon brain

| Youwee feature | where it lives now |
|---|---|
| Audio extraction (MP3/M4A/Opus) | `ev_start` — `-x --audio-format <choice>` |
| Subtitles (download / embed) | `ev_start` — `--write-subs`, `--embed-subs` (embed implies write) |
| SponsorBlock | `ev_start` — `--sponsorblock-remove sponsor,intro,outro,selfpromo` |
| Speed limit | `ev_start` — aria2 `--max-overall-download-limit` via `--downloader-args` |
| Batch / playlist | `ev_start` — playlist mode drops `--no-playlist` |
| Download library | `HISTORY` registry persisted to `history.json` |
| Settings persistence | `ev_set_pref` / `ev_init` round-trip `settings.json` |
| Themes | theme name persists in operon; accent rendering in the host |
| Format menu | `dl_on_meta` — deduped, resolution-sorted |
| Progress | `dl_on_line` — `[download] 45.2% …` parsed operon-side |
| Tool detection | `sys_check` — green/red dots, PATH-only honesty |

Every one of those is **decided in operon**; the window only renders and
forwards clicks (`ev_*` genes).

## The TubeForge Lite contract (carried over)

- **Under 30 MB** (CI gate fails the build above that; typical build ≈ 15 MB)
- **aria2 is the only bundled tool** (embedded in the exe, extracted to
  `%LOCALAPPDATA%\YouweeOperon\bin` on first run; GPLv2+ notice shipped)
- **yt-dlp and ffmpeg come from your PATH** — the app detects them and shows
  a green/red dot per tool; nothing is downloaded behind your back
- No server, no browser, no Python, no vendored toolchain
- Long children are supervised by the host because operon's `run()`
  containment caps children at 5 min **by design**; every progress line
  still flows back through the operon state machine

## Build

Local (Linux, compile + headless logic tests) — needs an operon checkout at
`../../tf-operon` (pinned main):

```bash
cd desktop-operon
cargo test -p ywcore            # operon brain: boot, fetch, argv, progress, Youwee options, flow
cargo build -p youwee-operon    # GUI compile check (dev builds carry no aria2)
```

Windows exe: tag `v*` (or dispatch the workflow) — `.github/workflows/operon-desktop.yml`
builds on `windows-latest` with the official aria2 win-64 binary embedded
(`TF_ARIA2`), enforces the 30 MB gate, and attaches
`Youwee-Operon-win-x64.zip` (+ `SHA256SUMS.txt`) to the release.

## Gates (the "it actually works" list)

1. `cargo test -p ywcore` — 6 unit tests including two Youwee-specific ones
   (`youwee_options_shape_the_download_argv`, `defaults_stay_clean`)
2. end-to-end flow regression (`tests/flow.rs`) — a fake yt-dlp child
   streams progress for ~3 s while the host supervises; the job must reach
   `done` through the operon state machine and land in history
3. `--smoke` — CI runs the shipped exe headlessly on Windows: the exact GUI
   boot path, aria2 blob extraction, operon `ev_init` on a tool-less runner
4. size gate — the exe must stay under 30 MB
