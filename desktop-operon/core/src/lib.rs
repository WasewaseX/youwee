//! ywcore — Youwee Operon Edition, desktop core.
//!
//! This is the operon port of Youwee's downloader core: the same "real
//! native desktop app" architecture proven in TubeForge Desktop v2, wearing
//! Youwee's UX. Embeds the operon interpreter (the language's own lib
//! target) and bridges the desktop host (egui shell) to the app logic
//! written in operon.
//!
//! Division of labor:
//!   - operon (op/app.op) is the BRAIN: URL validation, yt-dlp argv building
//!     (audio formats, subtitles, SponsorBlock, speed limits, playlists),
//!     progress-line parsing, the job state machine, settings + history
//!     persistence, tool detection. Everything that decides.
//!   - the host is the BODY: one native window (no HTTP server, no browser),
//!     long-lived child processes (yt-dlp runs for minutes — the interpreter
//!     run() containment caps children at 5 min by design, so the host,
//!     which grants the capabilities, supervises them itself), and the clock.
//!
//! Protocol: every bridge call passes ONE JSON string argument and reads ONE
//! JSON string back — parsed and serialized with the language's own
//! json_parse/json_stringify (the core eats its own food, zero extra crates).
//! `promote()` output from the app lands in a stdout_sink ring the host
//! drains into the log panel.

use operon::interp::{json_stringify, Caps};
use operon::tools::{self, Loaded, Opts};
use operon::value::Value;
use std::cell::RefCell;
use std::rc::Rc;

pub mod children;

/// Capability grants the host gives the app. Default-deny, exactly like the
/// CLI launcher contract: the app can read/write its own dirs and temp, run
/// the named effectors, and read the few env vars it needs. No net grants —
/// a desktop app has no reason to open sockets, the tools it spawns do that.
#[derive(Clone, Debug, Default)]
pub struct Grants {
    pub read: Vec<String>,
    pub write: Vec<String>,
    pub run: Vec<String>,
    pub env: Vec<String>,
}

impl Grants {
    fn to_caps(&self) -> Result<Caps, String> {
        let mut caps = Caps::default();
        let mut grant = |kind: &str, v: &String| -> Result<(), String> {
            caps.add_grant(kind, v)
                .map_err(|s| format!("grant {} '{}': {}", kind, v, s.message))
        };
        for p in &self.read {
            grant("read", p)?;
        }
        for p in &self.write {
            grant("write", p)?;
        }
        for p in &self.run {
            grant("run", p)?;
        }
        for p in &self.env {
            grant("env", p)?;
        }
        Ok(caps)
    }
}

pub struct Runtime {
    l: Loaded,
    logs: Rc<RefCell<Vec<String>>>,
    entry_opts: Opts,
}

fn stress_str(s: &operon::value::Stress) -> String {
    format!("[{}] {}", s.kind, s.message)
}

impl Runtime {
    /// Load the operon app (executes its top-level bindings), set the VM lane
    /// and the run-wide fuel pool, then invoke its `main` gene (boot).
    pub fn boot(app_path: &str, grants: &Grants) -> Result<Runtime, String> {
        let logs: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
        let caps = grants.to_caps()?;
        let opts = Opts {
            cell: None,
            variant: None,
            rna: None,
            entry: Some("main".to_string()),
            use_ires: false,
            frame: None,
            args: Vec::new(),
            quiet: true,
            caps,
            profile: false,
            spans: false,
            stdout_sink: Some(logs.clone()),
            use_vm: true,
        };
        let mut l = tools::load_file(app_path, &opts)?;
        // run-wide shared fuel pool (SPEC §9b): host + every worker cell drain
        // ONE pool, a runaway loop cannot multiply the budget.
        l.interp.fuel_pool = Some(std::sync::Arc::new(std::sync::atomic::AtomicI64::new(
            500_000_000,
        )));
        // the VM lane, default encoding — the lane the whole differential
        // suite and the compat matrix gate on.
        l.interp.vm = true;
        l.interp.vm_opt = 0;
        l.interp.vm_program = Some(operon::vm::VmProgram::default());
        // short children (version probes, folder opens) get a 60 s ceiling;
        // LONG children are never run through run() — the host supervises
        // them, which is the whole point of the desktop split.
        l.interp
            .cell
            .insert("run.timeout_ms".to_string(), "60000".to_string());
        tools::run_entry(&mut l, &opts).map_err(|s| stress_str(&s))?;
        Ok(Runtime {
            l,
            logs,
            entry_opts: opts,
        })
    }

    /// Call an app gene with one JSON argument; the return value comes back
    /// as JSON (both directions through the language's own JSON codec).
    /// The argument is a JSON DOCUMENT: a quoted string literal arrives as a
    /// bare string, an object arrives as a map; non-JSON text falls back to
    /// being passed through as-is.
    pub fn call(&mut self, gene: &str, arg: Option<&str>) -> Result<String, String> {
        let genv = self.l.interp.global.clone();
        let args = match arg {
            Some(s) => vec![match operon::interp::json_parse(s) {
                Ok(v) => v,
                Err(_) => Value::Str(s.to_string()),
            }],
            None => Vec::new(),
        };
        match self.l.interp.call_named(&genv, gene, args, None) {
            Ok(v) => Ok(json_stringify(&v)),
            Err(s) => Err(stress_str(&s)),
        }
    }

    /// Drain the app's promote() ring (the log panel feed).
    pub fn drain_logs(&mut self) -> Vec<String> {
        std::mem::take(&mut *self.logs.borrow_mut())
    }

    /// Re-run the entry gene (unused today; kept for future re-boot paths).
    pub fn reentry(&mut self) -> Result<String, String> {
        tools::run_entry(&mut self.l, &self.entry_opts)
            .map(|v| json_stringify(&v))
            .map_err(|s| stress_str(&s))
    }
}

/// JSON-escape a Rust string for hand-built host->app payloads.
pub fn jstr(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "ywcore-test-{}-{}-{}",
            tag,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(d.join("data")).unwrap();
        std::fs::create_dir_all(d.join("out")).unwrap();
        d
    }

    fn boot(tag: &str) -> (Runtime, std::path::PathBuf) {
        let root = temp_root(tag);
        let op_path = root.join("app.op");
        std::fs::write(&op_path, include_str!("../../op/app.op")).unwrap();
        let g = Grants {
            read: vec![root.to_string_lossy().to_string()],
            write: vec![root.to_string_lossy().to_string()],
            run: vec!["yt-dlp".into(), "ffmpeg".into(), "ffprobe".into()],
            env: vec!["TEMP".into(), "TMP".into(), "OS".into()],
        };
        let rt = Runtime::boot(op_path.to_str().unwrap(), &g).expect("boot");
        (rt, root)
    }

    #[test]
    fn boots_and_inits() {
        let (mut rt, root) = boot("init");
        // jstr: paths MUST be JSON-escaped — on Windows the raw backslashes
        // would form invalid escapes (\U, \T...) and ev_init would read nulls
        let cfg = format!(
            "{{\"out_dir\":{},\"data_dir\":{},\"aria2\":{}}}",
            jstr(&root.join("out").to_string_lossy()),
            jstr(&root.join("data").to_string_lossy()),
            jstr(&root.join("bin/aria2c.exe").to_string_lossy())
        );
        let out = rt.call("ev_init", Some(&cfg)).expect("ev_init");
        assert!(out.contains("\"ok\":true"), "ev_init -> {}", out);
        let tick = rt.call("ui_tick", None).expect("ui_tick");
        assert!(
            tick.contains("\"jobs\"") && tick.contains("\"tools\""),
            "{}",
            tick
        );
        // Youwee Operon settings surface: the Youwee feature keys all exist
        for key in [
            "audio_format",
            "subs",
            "embed_subs",
            "sponsorblock",
            "speed_limit",
            "playlist",
            "theme",
        ] {
            assert!(tick.contains(key), "settings missing {} in {}", key, tick);
        }
    }

    #[test]
    fn fetch_validates_url_and_builds_argv() {
        let (mut rt, root) = boot("fetch");
        init(&mut rt, &root);
        let bad = rt
            .call("ev_fetch", Some("\"not a url\""))
            .expect("ev_fetch");
        assert!(bad.contains("\"ok\":false"), "{}", bad);
        let good = rt
            .call("ev_fetch", Some("\"https://youtu.be/abc123\""))
            .expect("ev_fetch");
        assert!(good.contains("\"ok\":true"), "{}", good);
        assert!(good.contains("yt-dlp") && good.contains("-J"), "{}", good);
    }

    #[test]
    fn meta_builds_sorted_menu() {
        let (mut rt, root) = boot("meta");
        init(&mut rt, &root);
        let r = rt
            .call("ev_fetch", Some("\"https://youtu.be/abc123\""))
            .unwrap();
        let id = json_field(&r, "id").expect("id");
        let info = r#"{"title":"Test Video","uploader":"ch","duration":61,"webpage_url":"https://youtu.be/abc123","formats":[
            {"format_id":"18","ext":"mp4","height":360,"vcodec":"avc1","acodec":"mp4a","filesize":1000000},
            {"format_id":"137","ext":"mp4","height":1080,"vcodec":"avc1","acodec":"none","filesize":90000000},
            {"format_id":"140","ext":"m4a","height":null,"vcodec":"none","acodec":"mp4a","filesize":3000000}]}"#;
        let arg = format!(
            "{{\"id\":\"{}\",\"ok\":\"1\",\"payload\":{}}}",
            id,
            jstr(info)
        );
        let out = rt.call("dl_on_meta", Some(&arg)).expect("dl_on_meta");
        assert!(out.contains("\"ok\":true"), "{}", out);
        let tick = rt.call("ui_tick", None).unwrap();
        // 1080p must precede 360p in the sorted menu
        let p1080 = tick.find("1080p").expect("1080 present");
        let p360 = tick.find("360p").expect("360 present");
        assert!(p1080 < p360, "menu not sorted: {}", tick);
        assert!(tick.contains("Test Video"), "{}", tick);
    }

    #[test]
    fn start_builds_aria2_argv_and_parses_progress() {
        let (mut rt, root) = boot("start");
        init(&mut rt, &root);
        let r = rt
            .call("ev_fetch", Some("\"https://youtu.be/abc123\""))
            .unwrap();
        let id = json_field(&r, "id").unwrap();
        let info = r#"{"title":"T","uploader":"u","duration":1,"webpage_url":"https://youtu.be/abc123","formats":[{"format_id":"137","ext":"mp4","height":1080,"vcodec":"avc1","acodec":"none","filesize":1000}]}"#;
        let m = format!(
            "{{\"id\":\"{}\",\"ok\":\"1\",\"payload\":{}}}",
            id,
            jstr(info)
        );
        rt.call("dl_on_meta", Some(&m)).unwrap();
        let s = rt
            .call(
                "ev_start",
                Some(&format!(
                    "{{\"meta_id\":\"{}\",\"format_id\":\"\",\"mode\":\"video\"}}",
                    id
                )),
            )
            .unwrap();
        assert!(s.contains("\"ok\":true"), "{}", s);
        assert!(s.contains("aria2c"), "argv should carry aria2: {}", s);
        assert!(s.contains("-f"), "{}", s);
        // default: single video (no playlist) — --no-playlist rides along
        assert!(s.contains("--no-playlist"), "{}", s);
        let jid = json_field(&s, "id").unwrap();

        let line = format!(
            "{{\"id\":\"{}\",\"line\":\"[download]  45.2% of ~  9.87MiB at    2.35MiB/s ETA 00:03\"}}",
            jid
        );
        rt.call("dl_on_line", Some(&line)).unwrap();
        let tick = rt.call("ui_tick", None).unwrap();
        assert!(tick.contains("45.2"), "{}", tick);
        assert!(tick.contains("downloading"), "{}", tick);
        assert!(tick.contains("2.35MiB/s"), "{}", tick);
        assert!(tick.contains("00:03"), "{}", tick);

        let e = format!("{{\"id\":\"{}\",\"code\":0,\"tail\":\"\"}}", jid);
        rt.call("dl_on_exit", Some(&e)).unwrap();
        let tick = rt.call("ui_tick", None).unwrap();
        assert!(tick.contains("done"), "{}", tick);
    }

    /// Youwee features ported into the brain: audio format choice, subtitles
    /// (sidecar + embed), SponsorBlock, speed limit, playlist mode.
    #[test]
    fn youwee_options_shape_the_download_argv() {
        let (mut rt, root) = boot("opts");
        init(&mut rt, &root);
        let r = rt
            .call("ev_fetch", Some("\"https://youtu.be/abc123\""))
            .unwrap();
        let id = json_field(&r, "id").unwrap();
        let info = r#"{"title":"T","uploader":"u","duration":1,"webpage_url":"https://youtu.be/abc123","formats":[{"format_id":"140","ext":"m4a","height":null,"vcodec":"none","acodec":"mp4a","filesize":1000}]}"#;
        let m = format!(
            "{{\"id\":\"{}\",\"ok\":\"1\",\"payload\":{}}}",
            id,
            jstr(info)
        );
        rt.call("dl_on_meta", Some(&m)).unwrap();

        // the user tunes Youwee's settings through the same gene the UI uses
        let p = rt
            .call(
                "ev_set_pref",
                Some(
                    r#"{"audio_format":"m4a","subs":true,"embed_subs":true,"sponsorblock":true,"speed_limit":"5M","playlist":true}"#,
                ),
            )
            .unwrap();
        assert!(p.contains("\"ok\":true"), "{}", p);

        let s = rt
            .call(
                "ev_start",
                Some(&format!(
                    "{{\"meta_id\":\"{}\",\"format_id\":\"\",\"mode\":\"audio\"}}",
                    id
                )),
            )
            .unwrap();
        assert!(s.contains("\"ok\":true"), "{}", s);
        // audio extraction with the CHOSEN format (Youwee: mp3/m4a/opus)
        assert!(s.contains("--audio-format") && s.contains("m4a"), "{}", s);
        // SponsorBlock removal (Youwee feature)
        assert!(s.contains("--sponsorblock-remove"), "{}", s);
        // subtitles: sidecar + embed (embed implies --write-subs)
        assert!(s.contains("--write-subs"), "{}", s);
        assert!(s.contains("--embed-subs"), "{}", s);
        // playlist mode ON: --no-playlist must be GONE
        assert!(
            !s.contains("--no-playlist"),
            "playlist mode still single: {}",
            s
        );
        // speed limit reaches aria2 through --downloader-args
        assert!(s.contains("aria2c:"), "{}", s);
        let dl_args_idx = s.find("aria2c:").expect("aria2 downloader args");
        assert!(
            s[dl_args_idx..].contains("--max-overall-download-limit=5M"),
            "speed limit not injected: {}",
            s
        );

        // and the settings file persisted the whole preference set
        let saved = std::fs::read_to_string(root.join("data/settings.json")).unwrap();
        for key in ["m4a", "sponsorblock", "5M"] {
            assert!(
                saved.contains(key),
                "settings.json missing {}: {}",
                key,
                saved
            );
        }
    }

    /// Speed limit OFF (empty) leaves the aria2 args untouched; a fresh
    /// default boot must not carry Youwee options into the argv.
    #[test]
    fn defaults_stay_clean() {
        let (mut rt, root) = boot("clean");
        init(&mut rt, &root);
        let r = rt
            .call("ev_fetch", Some("\"https://youtu.be/abc123\""))
            .unwrap();
        let id = json_field(&r, "id").unwrap();
        let info = r#"{"title":"T","uploader":"u","duration":1,"webpage_url":"https://youtu.be/abc123","formats":[{"format_id":"137","ext":"mp4","height":1080,"vcodec":"avc1","acodec":"none","filesize":1000}]}"#;
        let m = format!(
            "{{\"id\":\"{}\",\"ok\":\"1\",\"payload\":{}}}",
            id,
            jstr(info)
        );
        rt.call("dl_on_meta", Some(&m)).unwrap();
        let s = rt
            .call(
                "ev_start",
                Some(&format!(
                    "{{\"meta_id\":\"{}\",\"format_id\":\"\",\"mode\":\"video\"}}",
                    id
                )),
            )
            .unwrap();
        assert!(!s.contains("--sponsorblock-remove"), "{}", s);
        assert!(!s.contains("--write-subs"), "{}", s);
        assert!(!s.contains("--embed-subs"), "{}", s);
        assert!(!s.contains("--max-overall-download-limit"), "{}", s);
        // no audio extraction by default ("-x" must not appear as an argv
        // ELEMENT — the aria2 downloader-args string also contains "-x 8")
        assert!(!s.contains("\"-x\""), "{}", s);
    }

    fn init(rt: &mut Runtime, root: &std::path::Path) {
        // jstr: same Windows-path escaping requirement as boots_and_inits —
        // unescaped backslashes turned BOOT.out_dir into null, which unfolded
        // ev_start's `out + "/" + template` into "cannot add null and str"
        let cfg = format!(
            "{{\"out_dir\":{},\"data_dir\":{},\"aria2\":{}}}",
            jstr(&root.join("out").to_string_lossy()),
            jstr(&root.join("data").to_string_lossy()),
            jstr(&root.join("bin/aria2c.exe").to_string_lossy())
        );
        rt.call("ev_init", Some(&cfg)).expect("ev_init");
    }

    /// Minimal JSON string-field extractor for the tests (the bridge returns
    /// compact JSON; tests assert on substrings + pull ids).
    fn json_field(json: &str, key: &str) -> Option<String> {
        let pat = format!("\"{}\":\"", key);
        let i = json.find(&pat)? + pat.len();
        let rest = &json[i..];
        let end = rest.find('"')?;
        Some(rest[..end].to_string())
    }
}
