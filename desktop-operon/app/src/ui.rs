//! ui.rs — the Youwee Operon renderer: egui drawing for the port.
//!
//! Thin by design: the widget tree renders whatever `ui_tick()` (operon)
//! reports; clicks translate 1:1 into `ev_*` gene calls. The ONLY local
//! decisions are visual (which accent a theme name maps to). No app
//! decisions live here.

use crate::{App, MetaV};
use eframe::egui;

#[derive(PartialEq, Clone, Copy)]
pub enum Tab {
    Download,
    Queue,
    Library,
    Settings,
    Log,
}

/// Youwee's six themes, mapped to an accent color. The NAME persists in the
/// operon settings (the brain owns it); the color lives here (rendering).
fn accent(theme: &str) -> egui::Color32 {
    match theme {
        "aurora" => egui::Color32::from_rgb(80, 220, 180),
        "sunset" => egui::Color32::from_rgb(255, 150, 80),
        "ocean" => egui::Color32::from_rgb(80, 170, 250),
        "forest" => egui::Color32::from_rgb(90, 200, 120),
        "candy" => egui::Color32::from_rgb(240, 120, 200),
        _ => egui::Color32::from_rgb(140, 120, 255), // midnight
    }
}

pub const THEMES: [&str; 6] = ["midnight", "aurora", "sunset", "ocean", "forest", "candy"];
pub const AUDIO_FORMATS: [&str; 3] = ["mp3", "m4a", "opus"];

pub fn draw(app: &mut App, ctx: &egui::Context) {
    let acc = accent(&app.view.settings.theme);
    top_panel(app, ctx, acc);
    bottom_tabs(app, ctx, acc);
    egui::CentralPanel::default().show(ctx, |ui| {
        if let Some(err) = &app.boot_err {
            ui.colored_label(
                egui::Color32::RED,
                format!(
                    "Youwee Operon failed to start:\n{}\n\nClose and reopen the app.",
                    err
                ),
            );
            return;
        }
        match app.tab {
            Tab::Download => download_tab(app, ui),
            Tab::Queue => queue_tab(app, ui, acc),
            Tab::Library => library_tab(app, ui),
            Tab::Settings => settings_tab(app, ui, acc),
            Tab::Log => log_tab(app, ui),
        }
    });
}

fn top_panel(app: &mut App, ctx: &egui::Context, acc: egui::Color32) {
    egui::TopBottomPanel::top("yw-top").show(ctx, |ui| {
        ui.add_space(6.0);
        ui.horizontal(|ui| {
            ui.label(
                egui::RichText::new("Youwee Operon")
                    .size(20.0)
                    .strong()
                    .color(acc),
            );
            ui.label(
                egui::RichText::new(format!("v{} — the operon port", crate::VERSION))
                    .weak()
                    .small(),
            );
            if !app.aria2_bundled {
                ui.label(
                    egui::RichText::new("dev build: aria2 NOT bundled")
                        .small()
                        .color(egui::Color32::YELLOW),
                );
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                for t in app.view.tools.clone() {
                    let color = if t.ok {
                        egui::Color32::from_rgb(80, 220, 120)
                    } else {
                        egui::Color32::from_rgb(235, 90, 90)
                    };
                    ui.label(egui::RichText::new(format!("● {}", t.name)).color(color))
                        .on_hover_text(if t.ok {
                            format!("{} — found ({})", t.name, t.ver)
                        } else {
                            format!(
                                "{} — NOT found on PATH. Install it or add it to PATH, then press the ↻ button in the Folder row.",
                                t.name
                            )
                        });
                }
            });
        });
        ui.add_space(2.0);
        ui.horizontal(|ui| {
            let resp = ui.add(
                egui::TextEdit::singleline(&mut app.url)
                    .hint_text("Paste a video URL (YouTube, TikTok, …) and press Fetch")
                    .desired_width(f32::INFINITY),
            );
            let enter =
                resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter));
            if enter || ui.button(egui::RichText::new("Fetch").strong()).clicked() {
                app.act_fetch();
            }
        });
        ui.add_space(4.0);
    });
}

fn bottom_tabs(app: &mut App, ctx: &egui::Context, acc: egui::Color32) {
    let active = app.tab;
    let queue_n = app.view.jobs.len();
    egui::TopBottomPanel::bottom("yw-tabs").show(ctx, |ui| {
        ui.add_space(2.0);
        ui.horizontal(|ui| {
            if tab_btn(ui, active, Tab::Download, "⬇ Download", acc) {
                app.tab = Tab::Download;
            }
            if tab_btn(
                ui,
                active,
                Tab::Queue,
                &format!("≡ Queue ({})", queue_n),
                acc,
            ) {
                app.tab = Tab::Queue;
            }
            if tab_btn(ui, active, Tab::Library, "▦ Library", acc) {
                app.tab = Tab::Library;
            }
            if tab_btn(ui, active, Tab::Settings, "⚙ Settings", acc) {
                app.tab = Tab::Settings;
            }
            if tab_btn(ui, active, Tab::Log, "▤ Log", acc) {
                app.tab = Tab::Log;
            }
        });
        ui.add_space(2.0);
    });
}

fn tab_btn(ui: &mut egui::Ui, active: Tab, tab: Tab, label: &str, acc: egui::Color32) -> bool {
    let mut text = egui::RichText::new(label);
    if active == tab {
        text = text.strong().color(acc);
    }
    ui.add(egui::SelectableLabel::new(active == tab, text))
        .clicked()
}

fn download_tab(app: &mut App, ui: &mut egui::Ui) {
    folder_row(app, ui);
    ui.separator();
    let sel = app.selected_meta.clone();
    match sel {
        None => {
            ui.add_space(20.0);
            ui.vertical_centered(|ui| {
                ui.label(
                    egui::RichText::new("Paste a video URL above and press Fetch.")
                        .size(15.0)
                        .weak(),
                );
                ui.label(
                    egui::RichText::new(
                        "yt-dlp and ffmpeg come from your PATH — Youwee Operon only bundles aria2.",
                    )
                    .weak()
                    .small(),
                );
            });
        }
        Some(mid) => {
            let meta = app.view.metas.iter().find(|m| m.id == mid).cloned();
            match meta {
                Some(m) => draw_meta(app, ui, &m),
                None => {
                    ui.spinner();
                    ui.label("working…");
                }
            }
        }
    }
}

fn folder_row(app: &mut App, ui: &mut egui::Ui) {
    ui.horizontal(|ui| {
        ui.label("Folder:");
        let out = app.view.settings.out_dir.clone();
        ui.add(egui::Label::new(egui::RichText::new(trunc(&out, 58)).monospace()).truncate());
        if cfg!(target_os = "windows") && ui.button("Change…").clicked() {
            app.sup.pick_folder();
        }
        if ui.button("Open").clicked() {
            app.act_open_out();
        }
        if ui.button("↻ tools").clicked() {
            app.act_recheck();
        }
        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
            ui.checkbox(&mut app.mode_audio, "audio only");
        });
    });
}

fn draw_meta(app: &mut App, ui: &mut egui::Ui, m: &MetaV) {
    if m.state == "extracting" {
        ui.horizontal(|ui| {
            ui.spinner();
            ui.label("reading metadata…");
        });
        return;
    }
    if m.state == "error" {
        ui.colored_label(
            egui::Color32::from_rgb(235, 90, 90),
            format!("metadata failed: {}", trunc(&m.error, 400)),
        );
        if ui.button("Dismiss").clicked() {
            app.selected_meta = None;
        }
        return;
    }
    ui.horizontal(|ui| {
        ui.heading(trunc(&m.title, 70));
    });
    ui.label(
        egui::RichText::new(format!(
            "{}  ·  {}",
            trunc(&m.uploader, 50),
            fmt_dur(m.duration)
        ))
        .weak()
        .small(),
    );
    ui.add_space(4.0);
    egui::ScrollArea::vertical()
        .max_height(300.0)
        .show(ui, |ui| {
            let mut pick: Option<String> = None;
            for f in &m.formats {
                let selected = app
                    .picked_format
                    .get(&m.id)
                    .map(|x| x == &f.id)
                    .unwrap_or(false);
                let size = if f.size > 0.0 {
                    format!("≈ {}", fmt_bytes(f.size))
                } else {
                    String::new()
                };
                let text = format!("{}  {}  [{}]", f.label, size, f.id);
                if ui
                    .add(egui::SelectableLabel::new(
                        selected,
                        egui::RichText::new(text),
                    ))
                    .clicked()
                {
                    pick = Some(f.id.clone());
                }
            }
            if let Some(p) = pick {
                app.picked_format.insert(m.id.clone(), p);
            }
        });
    ui.add_space(6.0);
    ui.horizontal(|ui| {
        let chosen = app.picked_format.get(&m.id).cloned().unwrap_or_default();
        if ui
            .button(
                egui::RichText::new(if chosen.is_empty() {
                    "⬇ Download best"
                } else {
                    "⬇ Download selected"
                })
                .strong(),
            )
            .clicked()
        {
            app.act_start(&m.id, &chosen);
        }
        if ui.button("Dismiss").clicked() {
            app.selected_meta = None;
        }
    });
}

fn queue_tab(app: &mut App, ui: &mut egui::Ui, acc: egui::Color32) {
    ui.horizontal(|ui| {
        ui.heading("Queue");
        if ui.button("Clear finished").clicked() {
            app.act_clear_finished();
        }
    });
    ui.separator();
    if app.view.jobs.is_empty() {
        ui.label(egui::RichText::new("No downloads yet.").weak());
        return;
    }
    let jobs = app.view.jobs.clone();
    egui::ScrollArea::vertical().show(ui, |ui| {
        for j in jobs {
            egui::Grid::new(format!("job-{}", j.id))
                .num_columns(2)
                .spacing([10.0, 3.0])
                .show(ui, |ui| {
                    let active =
                        matches!(j.state.as_str(), "starting" | "downloading" | "cancelling");
                    ui.vertical(|ui| {
                        ui.label(egui::RichText::new(trunc(&j.title, 72)).strong());
                        ui.label(
                            egui::RichText::new(format!(
                                "{}  ·  {}  ·  {}{}",
                                j.state,
                                j.format,
                                if j.speed.is_empty() {
                                    String::new()
                                } else {
                                    format!("{} ", j.speed)
                                },
                                if j.eta.is_empty() {
                                    String::new()
                                } else {
                                    format!("ETA {}", j.eta)
                                }
                            ))
                            .small()
                            .weak(),
                        );
                        if !j.error.is_empty() && j.state == "error" {
                            ui.colored_label(
                                egui::Color32::from_rgb(235, 90, 90),
                                trunc(&j.error, 220),
                            );
                        }
                    });
                    ui.vertical(|ui| {
                        let chip = egui::RichText::new(state_chip(&j.state))
                            .color(state_color(&j.state, acc));
                        ui.label(chip);
                        ui.add(
                            egui::ProgressBar::new(((j.progress / 100.0).clamp(0.0, 1.0)) as f32)
                                .show_percentage()
                                .desired_height(14.0),
                        );
                        if active && ui.small_button("Cancel").clicked() {
                            app.act_cancel(&j.id);
                        }
                    });
                    ui.end_row();
                });
            ui.separator();
        }
    });
}

fn library_tab(app: &mut App, ui: &mut egui::Ui) {
    ui.heading("Library");
    ui.separator();
    let hist = app.view.history.clone();
    if hist.is_empty() {
        ui.label(
            egui::RichText::new(
                "Nothing here yet. Every download you start is remembered across sessions \
                 (history.json in the app data folder).",
            )
            .weak(),
        );
    } else {
        egui::ScrollArea::vertical().show(ui, |ui| {
            for h in hist.iter().rev() {
                let icon = match h.state.as_str() {
                    "done" => "✅",
                    "error" => "❌",
                    "cancelled" => "✕",
                    _ => "⋯",
                };
                ui.horizontal(|ui| {
                    ui.label(icon);
                    ui.label(trunc(&h.title, 80));
                    ui.label(egui::RichText::new(&h.format).weak().small());
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.label(egui::RichText::new(h.state.clone()).weak().small());
                    });
                });
            }
        });
    }
    if ui.button("Open folder").clicked() {
        app.act_open_out();
    }
}

/// The Youwee settings panel: every toggle here lands in the operon brain
/// via ev_set_pref and is persisted by the brain itself (settings.json).
fn settings_tab(app: &mut App, ui: &mut egui::Ui, acc: egui::Color32) {
    ui.heading("Settings");
    ui.separator();

    // --- audio extraction ---------------------------------------------
    ui.horizontal(|ui| {
        ui.label("Audio format (audio-only mode):");
        let cur = app.view.settings.audio_format.clone();
        egui::ComboBox::from_id_salt("yw-audio-fmt")
            .selected_text(cur.clone())
            .show_ui(ui, |ui| {
                for f in AUDIO_FORMATS {
                    if ui.selectable_label(cur == f, f).clicked() {
                        let frag = format!("{{\"audio_format\":\"{}\"}}", f);
                        app.act_pref_json(&frag);
                    }
                }
            });
    });
    ui.separator();

    // --- download behavior toggles -------------------------------------
    // pattern: seed from the brain's authoritative value, let the checkbox
    // flip the local copy, send the NEW value on change; the next tick
    // reconciles the view from the brain
    let s = app.view.settings.clone();
    let mut sb = s.sponsorblock;
    if ui
        .checkbox(
            &mut sb,
            "SponsorBlock — remove sponsor / intro / outro / self-promo",
        )
        .changed()
    {
        let frag = format!("{{\"sponsorblock\":{}}}", sb);
        app.act_pref_json(&frag);
    }

    ui.horizontal(|ui| {
        let mut subs = s.subs;
        if ui
            .checkbox(&mut subs, "Download subtitles (en sidecar)")
            .changed()
        {
            let frag = format!("{{\"subs\":{}}}", subs);
            app.act_pref_json(&frag);
        }
        let mut embed = s.embed_subs;
        if ui
            .checkbox(&mut embed, "Embed subtitles into file")
            .changed()
        {
            let frag = format!("{{\"embed_subs\":{}}}", embed);
            app.act_pref_json(&frag);
        }
    });

    ui.horizontal(|ui| {
        let mut pl = s.playlist;
        if ui
            .checkbox(&mut pl, "Allow full-playlist downloads")
            .changed()
        {
            let frag = format!("{{\"playlist\":{}}}", pl);
            app.act_pref_json(&frag);
        }
    });
    ui.separator();

    // --- bandwidth ------------------------------------------------------
    ui.horizontal(|ui| {
        ui.label("Speed limit (aria2, e.g. 5M / 300K — empty = unlimited):");
        let resp = ui.add(
            egui::TextEdit::singleline(&mut app.speed_limit_edit)
                .desired_width(120.0)
                .hint_text("unlimited"),
        );
        app.speed_edit_focused = resp.has_focus();
        if resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
            app.act_set_speed_limit();
        }
        if ui.button("Apply").clicked() {
            app.act_set_speed_limit();
        }
    });
    ui.separator();

    // --- theme ----------------------------------------------------------
    ui.horizontal(|ui| {
        ui.label("Theme:");
        let cur = app.view.settings.theme.clone();
        egui::ComboBox::from_id_salt("yw-theme")
            .selected_text(cur.clone())
            .show_ui(ui, |ui| {
                for t in THEMES {
                    if ui.selectable_label(cur == t, t).clicked() {
                        let frag = format!("{{\"theme\":\"{}\"}}", t);
                        app.act_pref_json(&frag);
                    }
                }
            });
        ui.label(egui::RichText::new("●").color(acc));
    });

    ui.add_space(8.0);
    ui.label(
        egui::RichText::new(
            "All of these live in operon (op/app.op): the brain validates, shapes the \
             yt-dlp/aria2 arguments and persists settings.json. The window only renders.",
        )
        .weak()
        .small(),
    );
}

fn log_tab(app: &mut App, ui: &mut egui::Ui) {
    ui.heading("Log");
    ui.separator();
    egui::ScrollArea::vertical()
        .stick_to_bottom(true)
        .show(ui, |ui| {
            let lines = app.logs.clone();
            for l in lines {
                ui.label(egui::RichText::new(l).monospace().small());
            }
        });
}

// ---------------------------------------------------------------- helpers

fn state_chip(state: &str) -> String {
    match state {
        "starting" => "… starting",
        "downloading" => "▼ downloading",
        "cancelling" => "✕ cancelling",
        "cancelled" => "✕ cancelled",
        "done" => "✓ done",
        "error" => "! error",
        other => other,
    }
    .to_string()
}

fn state_color(state: &str, acc: egui::Color32) -> egui::Color32 {
    match state {
        "downloading" => acc,
        "done" => egui::Color32::from_rgb(80, 220, 120),
        "error" => egui::Color32::from_rgb(235, 90, 90),
        "cancelled" | "cancelling" => egui::Color32::from_rgb(230, 180, 70),
        _ => egui::Color32::from_rgb(170, 170, 170),
    }
}

fn trunc(s: &str, n: usize) -> String {
    let t: String = s.chars().take(n).collect();
    if s.chars().count() > n {
        format!("{}…", t)
    } else {
        t
    }
}

pub fn fmt_bytes(n: f64) -> String {
    let (v, unit) = if n >= 1024.0 * 1024.0 * 1024.0 {
        (n / (1024.0 * 1024.0 * 1024.0), "GB")
    } else if n >= 1024.0 * 1024.0 {
        (n / (1024.0 * 1024.0), "MB")
    } else if n >= 1024.0 {
        (n / 1024.0, "KB")
    } else {
        (n, "B")
    };
    if v >= 100.0 {
        format!("{:.0} {}", v, unit)
    } else {
        format!("{:.1} {}", v, unit)
    }
}

pub fn fmt_dur(secs: f64) -> String {
    if secs <= 0.0 {
        return String::new();
    }
    let s = secs as u64;
    if s >= 3600 {
        format!("{}h{:02}m", s / 3600, (s % 3600) / 60)
    } else if s >= 60 {
        format!("{}m{:02}s", s / 60, s % 60)
    } else {
        format!("{}s", s)
    }
}
