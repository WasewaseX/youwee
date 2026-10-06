//! main.rs — Youwee Operon Edition: the Youwee downloader core, ported to
//! the operon language, in a REAL native desktop window.
//!
//! What this is:
//!   - one native window (egui) — no HTTP server, no localhost, no browser,
//!     no Python launcher
//!   - the ONLY bundled tool is aria2 (embedded in this executable, extracted
//!     to the app data dir on first run); yt-dlp and ffmpeg are the user's
//!     own, found on PATH — the TubeForge Lite contract, carried over
//!   - ALL decision logic lives in operon (op/app.op) and runs on an embedded
//!     operon interpreter (the language's own lib target, VM lane):
//!     URL validation, yt-dlp argv building (audio mp3/m4a/opus, subtitles,
//!     SponsorBlock, speed limits, playlists), progress parsing, the job
//!     state machine, settings + history persistence, theme persistence
//!   - Youwee features ported into the brain: audio extraction, subtitle
//!     download/embed, SponsorBlock, bandwidth limit, playlist mode, download
//!     library, six-theme accent system
//!
//! The host supervises long children (children.rs) because operon's run()
//! containment caps children at 5 min by design; every progress line still
//! flows back through operon, where the state machine lives.

mod ui;

use eframe::egui;
use operon::value::{MapRef, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use ywcore::children::{Kind, Supervisor};
use ywcore::{Grants, Runtime};

static ARIA2: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/aria2c.exe"));
fn aria2_real() -> bool {
    env!("TF_ARIA2_REAL") == "1"
}
static APP_OP: &str = include_str!("../../op/app.op");
const VERSION: &str = "1.0.0";

const ARIA2_NOTICE: &str = "aria2c is bundled under the GNU GPLv2+.\n\
Source: https://github.com/aria2/aria2\n\
This notice is not legal advice; the full license text ships with the aria2 \
source and release archive.\n";

// ------------------------------------------------------------------ view

#[derive(Clone)]
pub struct JobV {
    pub id: String,
    pub title: String,
    pub state: String,
    pub progress: f64,
    pub speed: String,
    pub eta: String,
    pub error: String,
    pub format: String,
    pub url: String,
}

#[derive(Clone)]
pub struct FmtV {
    pub id: String,
    pub label: String,
    pub size: f64,
}

#[derive(Clone)]
pub struct MetaV {
    pub id: String,
    pub url: String,
    pub state: String,
    pub title: String,
    pub uploader: String,
    pub duration: f64,
    pub error: String,
    pub formats: Vec<FmtV>,
}

#[derive(Clone)]
pub struct ToolV {
    pub name: String,
    pub ok: bool,
    pub ver: String,
    pub src: String,
}

/// Mirror of the operon SETTINGS map (the brain owns the truth; this is the
/// render view + the checkbox binding cache).
#[derive(Clone)]
pub struct SetV {
    pub out_dir: String,
    pub prefer: String,
    pub template: String,
    pub mode: String,
    pub audio_format: String,
    pub subs: bool,
    pub embed_subs: bool,
    pub sponsorblock: bool,
    pub speed_limit: String,
    pub playlist: bool,
    pub theme: String,
}

impl Default for SetV {
    fn default() -> Self {
        SetV {
            out_dir: String::new(),
            prefer: String::new(),
            template: String::new(),
            mode: String::new(),
            audio_format: "mp3".to_string(),
            subs: false,
            embed_subs: false,
            sponsorblock: false,
            speed_limit: String::new(),
            playlist: false,
            theme: "midnight".to_string(),
        }
    }
}

#[derive(Clone)]
pub struct HistV {
    pub title: String,
    pub state: String,
    pub format: String,
    pub at: f64,
}

#[derive(Clone, Default)]
pub struct View {
    pub jobs: Vec<JobV>,
    pub metas: Vec<MetaV>,
    pub tools: Vec<ToolV>,
    pub settings: SetV,
    pub history: Vec<HistV>,
}

// ------------------------------------------------------------ value walk

fn mget(m: &MapRef, key: &str) -> Option<Value> {
    let b = m.borrow();
    b.position_str(key)
        .and_then(|i| b.get(i).map(|p| p.1.clone()))
}

fn vs(v: Option<Value>) -> String {
    match v {
        Some(Value::Str(s)) => s,
        Some(other) => other.display(),
        None => String::new(),
    }
}

fn vf(v: Option<Value>) -> f64 {
    match v {
        Some(Value::Int(i)) => i as f64,
        Some(Value::Float(f)) => f,
        _ => 0.0,
    }
}

fn vb(v: Option<Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
}

fn vlist(v: Option<Value>) -> Vec<Value> {
    match v {
        Some(Value::List(l)) => l.borrow().clone(),
        _ => Vec::new(),
    }
}

fn parse_view(json: &str) -> Option<View> {
    let v = operon::interp::json_parse(json).ok()?;
    let m = match v {
        Value::Map(m) => m,
        _ => return None,
    };
    let mut jobs = Vec::new();
    for j in vlist(mget(&m, "jobs")) {
        if let Value::Map(jm) = j {
            jobs.push(JobV {
                id: vs(mget(&jm, "id")),
                title: vs(mget(&jm, "title")),
                state: vs(mget(&jm, "state")),
                progress: vf(mget(&jm, "progress")),
                speed: vs(mget(&jm, "speed")),
                eta: vs(mget(&jm, "eta")),
                error: vs(mget(&jm, "error")),
                format: vs(mget(&jm, "format")),
                url: vs(mget(&jm, "url")),
            });
        }
    }
    let mut metas = Vec::new();
    for mv in vlist(mget(&m, "metas")) {
        if let Value::Map(mm) = mv {
            let mut formats = Vec::new();
            for f in vlist(mget(&mm, "formats")) {
                if let Value::Map(fm) = f {
                    formats.push(FmtV {
                        id: vs(mget(&fm, "id")),
                        label: vs(mget(&fm, "label")),
                        size: vf(mget(&fm, "size")),
                    });
                }
            }
            metas.push(MetaV {
                id: vs(mget(&mm, "id")),
                url: vs(mget(&mm, "url")),
                state: vs(mget(&mm, "state")),
                title: vs(mget(&mm, "title")),
                uploader: vs(mget(&mm, "uploader")),
                duration: vf(mget(&mm, "duration")),
                error: vs(mget(&mm, "error")),
                formats,
            });
        }
    }
    let mut tools = Vec::new();
    for t in vlist(mget(&m, "tools")) {
        if let Value::Map(tm) = t {
            tools.push(ToolV {
                name: vs(mget(&tm, "name")),
                ok: vb(mget(&tm, "ok")),
                ver: vs(mget(&tm, "ver")),
                src: vs(mget(&tm, "src")),
            });
        }
    }
    let settings = match mget(&m, "settings") {
        Some(Value::Map(sm)) => SetV {
            out_dir: vs(mget(&sm, "out_dir")),
            prefer: vs(mget(&sm, "prefer")),
            template: vs(mget(&sm, "template")),
            mode: vs(mget(&sm, "mode")),
            audio_format: vs(mget(&sm, "audio_format")),
            subs: vb(mget(&sm, "subs")),
            embed_subs: vb(mget(&sm, "embed_subs")),
            sponsorblock: vb(mget(&sm, "sponsorblock")),
            speed_limit: vs(mget(&sm, "speed_limit")),
            playlist: vb(mget(&sm, "playlist")),
            theme: vs(mget(&sm, "theme")),
        },
        _ => SetV::default(),
    };
    let mut history = Vec::new();
    for h in vlist(mget(&m, "history")) {
        if let Value::Map(hm) = h {
            history.push(HistV {
                title: vs(mget(&hm, "title")),
                state: vs(mget(&hm, "state")),
                format: vs(mget(&hm, "format")),
                at: vf(mget(&hm, "at")),
            });
        }
    }
    Some(View {
        jobs,
        metas,
        tools,
        settings,
        history,
    })
}

// ------------------------------------------------------------------ app

pub struct App {
    pub rt: Runtime,
    pub sup: Supervisor,
    pub bin_dir: PathBuf,
    pub data_dir: PathBuf,
    pub view: View,
    pub url: String,
    pub logs: Vec<String>,
    pub tab: ui::Tab,
    pub selected_meta: Option<String>,
    pub picked_format: HashMap<String, String>,
    pub mode_audio: bool,
    pub speed_limit_edit: String,
    pub speed_edit_focused: bool,
    pub boot_err: Option<String>,
    meta_body: HashMap<String, String>,
    err_tails: HashMap<String, String>,
    pending: Vec<(String, String)>,
    last_tick: Instant,
    aria2_bundled: bool,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        install_fonts(&cc.egui_ctx);
        cc.egui_ctx.set_visuals(egui::Visuals::dark());
        match Self::boot() {
            Ok(a) => a,
            Err(e) => Self::broken(e),
        }
    }

    fn boot() -> Result<Self, String> {
        let (data_dir, out_dir) = app_dirs();
        std::fs::create_dir_all(&data_dir).map_err(|e| format!("data dir: {}", e))?;
        let bin_dir = data_dir.join("bin");
        std::fs::create_dir_all(&bin_dir).ok();

        // extract the bundled aria2 (the ONLY bundled tool) on first run or
        // when the embedded binary is newer/different
        let mut aria2_bundled = false;
        let aria2_path = if aria2_real() {
            let dst = bin_dir.join(if cfg!(windows) {
                "aria2c.exe"
            } else {
                "aria2c"
            });
            let stale = std::fs::metadata(&dst)
                .map(|m| m.len() as usize != ARIA2.len())
                .unwrap_or(true);
            if stale {
                std::fs::write(&dst, ARIA2).map_err(|e| format!("extract aria2: {}", e))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&dst, std::fs::Permissions::from_mode(0o755)).ok();
                }
                std::fs::write(bin_dir.join("ARIA2-LICENSE-NOTICE.txt"), ARIA2_NOTICE).ok();
            }
            aria2_bundled = true;
            dst.to_string_lossy().to_string()
        } else {
            String::new()
        };

        // materialize the operon app next to the data (inspectable, upgradeable)
        let app_dir = data_dir.join("app");
        std::fs::create_dir_all(&app_dir).ok();
        let app_path = app_dir.join("app.op");
        std::fs::write(&app_path, APP_OP).map_err(|e| format!("write app.op: {}", e))?;

        let temp = std::env::var("TEMP")
            .or_else(|_| std::env::var("TMP"))
            .unwrap_or_else(|_| "/tmp".to_string());
        let grants = Grants {
            read: vec![
                data_dir.to_string_lossy().to_string(),
                out_dir.to_string_lossy().to_string(),
                temp.clone(),
            ],
            write: vec![
                data_dir.to_string_lossy().to_string(),
                out_dir.to_string_lossy().to_string(),
                temp.clone(),
            ],
            run: vec![
                "yt-dlp".into(),
                "ffmpeg".into(),
                "ffprobe".into(),
                "explorer".into(),
                "xdg-open".into(),
            ],
            env: vec!["TEMP".into(), "TMP".into(), "OS".into()],
        };
        let mut rt = Runtime::boot(app_path.to_str().ok_or("app path")?, &grants)?;
        let cfg = format!(
            "{{\"out_dir\":{},\"data_dir\":{},\"aria2\":{}}}",
            ywcore::jstr(&out_dir.to_string_lossy()),
            ywcore::jstr(&data_dir.to_string_lossy()),
            ywcore::jstr(&aria2_path),
        );
        rt.call("ev_init", Some(&cfg))?;

        let mut view = View::default();
        // prime the settings view from the brain (theme drives the accent
        // before the first tick)
        if let Ok(out) = rt.call("ui_tick", None) {
            if let Some(v) = parse_view(&out) {
                view = v;
            }
        }
        let speed_limit_edit = view.settings.speed_limit.clone();

        Ok(App {
            rt,
            sup: Supervisor::new(),
            bin_dir,
            data_dir,
            view,
            url: String::new(),
            logs: Vec::new(),
            tab: ui::Tab::Download,
            selected_meta: None,
            picked_format: HashMap::new(),
            mode_audio: false,
            speed_limit_edit,
            speed_edit_focused: false,
            boot_err: None,
            meta_body: HashMap::new(),
            err_tails: HashMap::new(),
            pending: Vec::new(),
            last_tick: Instant::now() - Duration::from_secs(1),
            aria2_bundled,
        })
    }

    fn broken(e: String) -> Self {
        // a boot failure must never panic the window: render the error and quit
        let (data_dir, _) = app_dirs();
        let null_op = std::env::temp_dir().join("youwee-operon-null.op");
        std::fs::write(&null_op, "gene main() { return {ok: false} }").ok();
        let grants = Grants::default();
        let rt = Runtime::boot(null_op.to_str().unwrap(), &grants)
            .unwrap_or_else(|_| panic!("interpreter cannot boot at all: {}", e));
        App {
            rt,
            sup: Supervisor::new(),
            bin_dir: data_dir.join("bin"),
            data_dir,
            view: View::default(),
            url: String::new(),
            logs: Vec::new(),
            tab: ui::Tab::Download,
            selected_meta: None,
            picked_format: HashMap::new(),
            mode_audio: false,
            speed_limit_edit: String::new(),
            speed_edit_focused: false,
            boot_err: Some(e),
            meta_body: HashMap::new(),
            err_tails: HashMap::new(),
            pending: Vec::new(),
            last_tick: Instant::now(),
            aria2_bundled: aria2_real(),
        }
    }

    // ------------------------------------------------------------ pump

    fn pump(&mut self) {
        for ev in self.sup.poll() {
            match ev {
                ywcore::children::Ev::Line { job, line } => {
                    if self.pending.len() < 4096 {
                        self.pending.push((job, line));
                    }
                }
                ywcore::children::Ev::ErrTail { job, tail } => {
                    if !tail.trim().is_empty() {
                        self.push_log(format!("[{} stderr] {}", job, last_lines(&tail, 3)));
                    }
                    self.err_tails.insert(job, tail);
                }
                ywcore::children::Ev::Exit { job, code } => self.on_exit(&job, code),
                ywcore::children::Ev::MetaBody { job, body } => {
                    self.meta_body.insert(job, body);
                }
                ywcore::children::Ev::FolderPick(p) => {
                    if let Some(p) = p {
                        let arg = ywcore::jstr(&p);
                        if let Err(e) = self.rt.call("ev_set_out", Some(&arg)) {
                            self.push_log(format!("[settings] {}", e));
                        }
                    }
                }
            }
        }
        // forward progress lines into the operon brain (bounded per frame)
        let take = self.pending.len().min(60);
        let batch: Vec<(String, String)> = self.pending.drain(..take).collect();
        for (job, line) in batch {
            let arg = format!(
                "{{\"id\":{},\"line\":{}}}",
                ywcore::jstr(&job),
                ywcore::jstr(&line)
            );
            if let Err(e) = self.rt.call("dl_on_line", Some(&arg)) {
                self.push_log(format!("[dl] {}", e));
            }
        }
    }

    fn on_exit(&mut self, job: &str, code: i32) {
        let tail = self.err_tails.remove(job).unwrap_or_default();
        if job.starts_with('m') {
            let body = self.meta_body.remove(job).unwrap_or_default();
            let ok = code == 0 && body.trim_start().starts_with('{');
            let payload = if ok { body } else { tail };
            let arg = format!(
                "{{\"id\":{},\"ok\":\"{}\",\"payload\":{}}}",
                ywcore::jstr(job),
                if ok { "1" } else { "0" },
                ywcore::jstr(&payload)
            );
            if let Err(e) = self.rt.call("dl_on_meta", Some(&arg)) {
                self.push_log(format!("[meta] {}", e));
            }
        } else {
            let arg = format!(
                "{{\"id\":{},\"code\":{},\"tail\":{}}}",
                ywcore::jstr(job),
                code,
                ywcore::jstr(&tail)
            );
            if let Err(e) = self.rt.call("dl_on_exit", Some(&arg)) {
                self.push_log(format!("[dl] {}", e));
            }
        }
    }

    fn push_log(&mut self, line: String) {
        self.logs.push(line);
        if self.logs.len() > 600 {
            self.logs.drain(..200);
        }
    }

    fn tick(&mut self) {
        for l in self.rt.drain_logs() {
            self.push_log(l);
        }
        match self.rt.call("ui_tick", None) {
            Ok(out) => {
                if let Some(v) = parse_view(&out) {
                    // do not clobber the speed-limit box while the user edits it
                    if !self.speed_edit_focused {
                        self.speed_limit_edit = v.settings.speed_limit.clone();
                    }
                    self.view = v;
                }
            }
            Err(e) => self.push_log(format!("[tick] {}", e)),
        }
        self.last_tick = Instant::now();
    }

    // ------------------------------------------------------------ actions

    pub fn act_fetch(&mut self) {
        if self.url.trim().is_empty() {
            return;
        }
        let arg = ywcore::jstr(&self.url.clone());
        match self.rt.call("ev_fetch", Some(&arg)) {
            Ok(out) => {
                if let Ok(Value::Map(ref m)) = operon::interp::json_parse(&out) {
                    let ok = vb(mget(m, "ok"));
                    if ok {
                        let id = vs(mget(m, "id"));
                        let argv: Vec<String> = vlist(mget(m, "argv"))
                            .into_iter()
                            .map(|a| a.display())
                            .collect();
                        let idc = id.clone();
                        if self
                            .sup
                            .spawn(&id, &argv, Kind::Meta, Some(self.bin_dir.as_path()))
                        {
                            self.selected_meta = Some(idc);
                            self.push_log("[fetch] reading metadata…".to_string());
                        }
                    } else {
                        self.push_log(format!("[fetch] {}", vs(mget(m, "message"))));
                    }
                }
            }
            Err(e) => self.push_log(format!("[fetch] {}", e)),
        }
    }

    pub fn act_start(&mut self, meta_id: &str, format_id: &str) {
        let mode = if self.mode_audio { "audio" } else { "video" };
        let arg = format!(
            "{{\"meta_id\":{},\"format_id\":{},\"mode\":{}}}",
            ywcore::jstr(meta_id),
            ywcore::jstr(format_id),
            ywcore::jstr(mode)
        );
        match self.rt.call("ev_start", Some(&arg)) {
            Ok(out) => {
                if let Ok(Value::Map(ref m)) = operon::interp::json_parse(&out) {
                    let ok = vb(mget(m, "ok"));
                    if ok {
                        let id = vs(mget(m, "id"));
                        let argv: Vec<String> = vlist(mget(m, "argv"))
                            .into_iter()
                            .map(|a| a.display())
                            .collect();
                        self.sup
                            .spawn(&id, &argv, Kind::Download, Some(self.bin_dir.as_path()));
                        self.push_log(format!("[job {}] queued", id));
                        self.tab = ui::Tab::Queue;
                    } else {
                        self.push_log(format!("[start] {}", vs(mget(m, "message"))));
                    }
                }
            }
            Err(e) => self.push_log(format!("[start] {}", e)),
        }
    }

    pub fn act_cancel(&mut self, id: &str) {
        let arg = ywcore::jstr(id);
        let _ = self.rt.call("ev_cancel", Some(&arg));
        self.sup.kill(id);
    }

    pub fn act_clear_finished(&mut self) {
        let _ = self.rt.call("ev_clear_finished", None);
    }

    pub fn act_open_out(&mut self) {
        let arg = ywcore::jstr(&self.view.settings.out_dir.clone());
        let _ = self.rt.call("sys_open_path", Some(&arg));
    }

    pub fn act_recheck(&mut self) {
        let _ = self.rt.call("ev_recheck_tools", None);
        self.last_tick = Instant::now() - Duration::from_secs(10);
    }

    /// Push a settings patch (a JSON fragment like `{"subs":true}`) into the
    /// brain. The brain merges non-null fields and persists settings.json.
    pub fn act_pref_json(&mut self, fragment: &str) {
        match self.rt.call("ev_set_pref", Some(fragment)) {
            Ok(_) => {
                self.last_tick = Instant::now() - Duration::from_secs(1);
            }
            Err(e) => self.push_log(format!("[settings] {}", e)),
        }
    }

    pub fn act_set_speed_limit(&mut self) {
        let v = self.speed_limit_edit.trim().to_string();
        let frag = format!("{{\"speed_limit\":{}}}", ywcore::jstr(&v));
        self.act_pref_json(&frag);
    }
}

// ------------------------------------------------------------------ glue

fn app_dirs() -> (PathBuf, PathBuf) {
    // data dir: per-user app data; downloads: next to the user's Downloads
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    let data = std::env::var("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("YouweeOperon"))
        .unwrap_or_else(|_| {
            std::env::var("XDG_DATA_HOME")
                .map(|d| PathBuf::from(d).join("youwee-operon"))
                .unwrap_or_else(|_| Path::new(&home).join(".local/share/youwee-operon"))
        });
    let out = Path::new(&home).join("Downloads").join("YouweeOperon");
    (data, out)
}

fn last_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join(" | ")
}

fn install_fonts(ctx: &egui::Context) {
    // best-effort CJK fallback so titles in any language render
    let mut fonts = egui::FontDefinitions::default();
    let candidates: &[&str] = &[
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simsun.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    ];
    for (i, file) in candidates.iter().enumerate() {
        if let Ok(bytes) = std::fs::read(file) {
            let name = format!("cjk{}", i);
            fonts
                .font_data
                .insert(name.clone(), egui::FontData::from_owned(bytes).into());
            for fam in [egui::FontFamily::Proportional, egui::FontFamily::Monospace] {
                fonts.families.entry(fam).or_default().push(name.clone());
            }
        }
    }
    ctx.set_fonts(fonts);
}

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.pump();
        if self.last_tick.elapsed() >= Duration::from_millis(250) {
            self.tick();
        }
        ui::draw(self, ctx);
        ctx.request_repaint_after(Duration::from_millis(120));
    }
}

fn main() -> Result<(), eframe::Error> {
    // --smoke: headless verification of THIS SHIPPED BINARY, for CI and for
    // the user ("v1 was broken" — so CI must run the actual exe). It takes
    // the exact GUI boot path (data dirs, aria2 extraction from the embedded
    // blob, app.op materialization, operon Runtime boot, ev_init on a
    // possibly tool-less machine) plus a state-machine tick, prints a
    // PASS/FAIL verdict and exits — never opens a window.
    if std::env::args().any(|a| a == "--smoke") {
        std::process::exit(match smoke() {
            Ok(report) => {
                println!("{}", report);
                0
            }
            Err(e) => {
                println!("SMOKE FAIL: {}", e);
                1
            }
        });
    }
    let opts = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1100.0, 700.0])
            .with_min_inner_size([880.0, 560.0])
            .with_title(format!("Youwee Operon v{} — powered by operon", VERSION)),
        ..Default::default()
    };
    eframe::run_native(
        "Youwee Operon",
        opts,
        Box::new(|cc| Ok(Box::new(App::new(cc)))),
    )
}

/// Headless boot verification: same code path as the windowed app.
fn smoke() -> Result<String, String> {
    let mut report = Vec::new();
    let t0 = Instant::now();

    // 1) the exact GUI boot path (this is what killed the old build: boot
    //    died on tool-less machines; here yt-dlp/ffmpeg are absent by design)
    let mut app = App::boot().map_err(|e| format!("boot: {}", e))?;
    report.push("boot: ok (operon Runtime + ev_init, tool-less machine tolerated)".to_string());

    // 2) the state machine must tick
    app.rt
        .call("ui_tick", None)
        .map_err(|e| format!("ui_tick: {}", e))?;
    report.push("ui_tick: ok".to_string());

    // 3) the embedded aria2 blob must have been extracted intact (when the
    //    build actually embedded it — TF_ARIA2_REAL=1 in release CI)
    if aria2_real() {
        let dst = app.bin_dir.join(if cfg!(windows) {
            "aria2c.exe"
        } else {
            "aria2c"
        });
        let len = std::fs::metadata(&dst)
            .map(|m| m.len())
            .map_err(|e| format!("aria2 extraction missing: {}", e))?;
        if len as usize != ARIA2.len() {
            return Err(format!(
                "aria2 extraction size mismatch: on disk {} != embedded {}",
                len,
                ARIA2.len()
            ));
        }
        report.push(format!(
            "aria2: extracted intact ({} bytes, embedded blob verified)",
            len
        ));
    } else {
        report.push("aria2: NOT embedded in this build (TF_ARIA2 unset) — skipped".to_string());
    }

    // 4) app.op version sanity: the materialized logic file must be the one
    //    this binary ships (byte-identical)
    let app_path = app.data_dir.join("app").join("app.op");
    let on_disk =
        std::fs::read_to_string(&app_path).map_err(|e| format!("app.op unreadable: {}", e))?;
    if on_disk != APP_OP {
        return Err("app.op on disk differs from the embedded logic".to_string());
    }
    report.push("app.op: byte-identical to embedded logic".to_string());

    report.push(format!("SMOKE PASS in {:?}", t0.elapsed()));
    Ok(report.join("\n"))
}
