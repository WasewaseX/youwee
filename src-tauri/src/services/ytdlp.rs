use crate::types::{
    BackendError, DependencySource, YtdlpAllVersions, YtdlpChannel, YtdlpChannelInfo,
    YtdlpVersionInfo,
};
use crate::utils::{
    find_system_binary, resolve_firefox_profile_for_cookies, unix_system_binary_dirs, CommandExt,
};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tokio::process::Command;

const CHANNEL_CONFIG_FILE: &str = "ytdlp-channel.txt";
const SOURCE_CONFIG_FILE: &str = "ytdlp-source.txt";
#[cfg(windows)]
const BUNDLED_YTDLP_BINARY_NAME: &str = "youwee-yt-dlp.exe";
#[cfg(not(windows))]
const BUNDLED_YTDLP_BINARY_NAME: &str = "youwee-yt-dlp";
#[cfg(windows)]
const LEGACY_BUNDLED_YTDLP_BINARY_NAME: &str = "yt-dlp.exe";
#[cfg(not(windows))]
const LEGACY_BUNDLED_YTDLP_BINARY_NAME: &str = "yt-dlp";
const BILIBILI_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
const BILIBILI_REFERER: &str = "https://www.bilibili.com/";

pub fn system_ytdlp_not_found_message() -> String {
    #[cfg(target_os = "macos")]
    {
        return "System yt-dlp not found. Install it with Homebrew (`brew install yt-dlp`) or switch to App managed in Settings > Dependencies.".to_string();
    }
    #[cfg(target_os = "windows")]
    {
        return "System yt-dlp not found. Install it with your package manager (e.g. `winget`, `choco`, or `scoop`) and ensure `yt-dlp` is available in PATH, or switch to App managed in Settings > Dependencies.".to_string();
    }
    #[cfg(target_os = "linux")]
    {
        return "System yt-dlp not found. Install it with your distro package manager and ensure `yt-dlp` is available in PATH, or switch to App managed in Settings > Dependencies.".to_string();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "System yt-dlp not found. Install it and ensure `yt-dlp` is available in PATH, or switch to App managed in Settings > Dependencies.".to_string()
    }
}

pub fn system_ytdlp_upgrade_message() -> String {
    #[cfg(target_os = "macos")]
    {
        return "System yt-dlp is managed externally. Update it with Homebrew (`brew upgrade yt-dlp`) or switch source to App managed.".to_string();
    }
    #[cfg(target_os = "windows")]
    {
        return "System yt-dlp is managed externally. Update it with your package manager (e.g. `winget`, `choco`, or `scoop`) or switch source to App managed.".to_string();
    }
    #[cfg(target_os = "linux")]
    {
        return "System yt-dlp is managed externally. Update it with your distro package manager or switch source to App managed.".to_string();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "System yt-dlp is managed externally. Update it with your package manager or switch source to App managed.".to_string()
    }
}

/// Get the config file path for storing yt-dlp source selection
fn get_source_config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("bin").join(SOURCE_CONFIG_FILE))
}

/// Read the current yt-dlp source from config file
pub async fn get_ytdlp_source(app: &AppHandle) -> DependencySource {
    if let Some(config_path) = get_source_config_path(app) {
        if let Ok(content) = tokio::fs::read_to_string(&config_path).await {
            return DependencySource::from_str(content.trim());
        }
    }
    DependencySource::Auto
}

/// Save the yt-dlp source to config file
pub async fn set_ytdlp_source(app: &AppHandle, source: &DependencySource) -> Result<(), String> {
    let config_path = get_source_config_path(app).ok_or("Failed to get config path")?;

    if let Some(parent) = config_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create bin directory: {}", e))?;
    }

    tokio::fs::write(&config_path, source.as_str())
        .await
        .map_err(|e| format!("Failed to save source config: {}", e))?;

    Ok(())
}

fn get_system_ytdlp_path() -> Option<PathBuf> {
    #[cfg(windows)]
    let binary_name = "yt-dlp.exe";
    #[cfg(not(windows))]
    let binary_name = "yt-dlp";

    find_system_binary(binary_name, &unix_system_binary_dirs())
}

/// Get the config file path for storing channel selection
fn get_channel_config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("bin").join(CHANNEL_CONFIG_FILE))
}

/// Read the current yt-dlp channel from config file
pub async fn get_ytdlp_channel(app: &AppHandle) -> YtdlpChannel {
    if let Some(config_path) = get_channel_config_path(app) {
        if let Ok(content) = tokio::fs::read_to_string(&config_path).await {
            return YtdlpChannel::from_str(content.trim());
        }
    }
    YtdlpChannel::Bundled
}

/// Save the yt-dlp channel to config file
pub async fn set_ytdlp_channel(app: &AppHandle, channel: &YtdlpChannel) -> Result<(), String> {
    let config_path = get_channel_config_path(app)
        .ok_or_else(|| BackendError::from_message("Failed to get config path").to_wire_string())?;

    // Ensure bin directory exists
    if let Some(parent) = config_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| {
            BackendError::from_message(format!("Failed to create bin directory: {}", e))
                .to_wire_string()
        })?;
    }

    tokio::fs::write(&config_path, channel.as_str())
        .await
        .map_err(|e| {
            BackendError::from_message(format!("Failed to save channel config: {}", e))
                .to_wire_string()
        })?;

    Ok(())
}

/// Get the binary name for a specific channel
fn get_channel_binary_name(channel: &YtdlpChannel) -> &'static str {
    #[cfg(windows)]
    match channel {
        YtdlpChannel::Bundled => "yt-dlp.exe",
        YtdlpChannel::Stable => "yt-dlp-stable.exe",
        YtdlpChannel::Nightly => "yt-dlp-nightly.exe",
    }
    #[cfg(not(windows))]
    match channel {
        YtdlpChannel::Bundled => "yt-dlp",
        YtdlpChannel::Stable => "yt-dlp-stable",
        YtdlpChannel::Nightly => "yt-dlp-nightly",
    }
}

/// Get the path to a specific channel's binary in app_data_dir
fn get_channel_binary_path(app: &AppHandle, channel: &YtdlpChannel) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|p| p.join("bin").join(get_channel_binary_name(channel)))
}

/// Legacy user-updated binary location in app_data_dir/bin/yt-dlp
fn get_legacy_ytdlp_path(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(windows)]
    let binary_name = "yt-dlp.exe";
    #[cfg(not(windows))]
    let binary_name = "yt-dlp";

    app.path().app_data_dir().ok().and_then(|app_data_dir| {
        let legacy_binary = app_data_dir.join("bin").join(binary_name);
        if legacy_binary.exists() {
            Some(legacy_binary)
        } else {
            None
        }
    })
}

/// Get the bundled yt-dlp path
fn get_bundled_ytdlp_path() -> Option<PathBuf> {
    // Check next to executable first
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for binary_name in [BUNDLED_YTDLP_BINARY_NAME, LEGACY_BUNDLED_YTDLP_BINARY_NAME] {
                let bundled = exe_dir.join(binary_name);
                if bundled.exists() {
                    return Some(bundled);
                }
            }
        }
    }
    None
}

/// Get info for all yt-dlp channels (lightweight - no binary execution)
pub async fn get_all_ytdlp_versions(app: &AppHandle) -> YtdlpAllVersions {
    let current_channel = get_ytdlp_channel(app).await;

    // Just check file existence - no --version calls needed
    let bundled_path = get_bundled_ytdlp_path();
    let stable_path = get_channel_binary_path(app, &YtdlpChannel::Stable);
    let nightly_path = get_channel_binary_path(app, &YtdlpChannel::Nightly);

    let bundled_exists = bundled_path.as_ref().map(|p| p.exists()).unwrap_or(false);
    let stable_exists = stable_path.as_ref().map(|p| p.exists()).unwrap_or(false);
    let nightly_exists = nightly_path.as_ref().map(|p| p.exists()).unwrap_or(false);

    let bundled = YtdlpChannelInfo {
        channel: "bundled".to_string(),
        version: None,
        installed: bundled_exists,
        binary_path: bundled_path.map(|p| p.to_string_lossy().to_string()),
    };

    let stable = YtdlpChannelInfo {
        channel: "stable".to_string(),
        version: None,
        installed: stable_exists,
        binary_path: stable_path.map(|p| p.to_string_lossy().to_string()),
    };

    let nightly = YtdlpChannelInfo {
        channel: "nightly".to_string(),
        version: None,
        installed: nightly_exists,
        binary_path: nightly_path.map(|p| p.to_string_lossy().to_string()),
    };

    // Check if using fallback (channel is stable/nightly but binary not installed)
    let using_fallback = match current_channel {
        YtdlpChannel::Bundled => false,
        YtdlpChannel::Stable => !stable_exists,
        YtdlpChannel::Nightly => !nightly_exists,
    };

    YtdlpAllVersions {
        current_channel: current_channel.as_str().to_string(),
        using_fallback,
        bundled,
        stable,
        nightly,
    }
}

/// Get download URL for a specific channel
pub fn get_ytdlp_channel_download_url(
    channel: &YtdlpChannel,
) -> Option<(&'static str, &'static str)> {
    match channel {
        YtdlpChannel::Bundled => None, // Bundled doesn't need download
        YtdlpChannel::Stable => {
            #[cfg(target_os = "macos")]
            {
                Some((
                    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
                    "yt-dlp_macos",
                ))
            }
            #[cfg(target_os = "linux")]
            {
                Some((
                    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
                    "yt-dlp_linux",
                ))
            }
            #[cfg(target_os = "windows")]
            {
                Some((
                    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
                    "yt-dlp.exe",
                ))
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
            {
                None
            }
        }
        YtdlpChannel::Nightly => {
            #[cfg(target_os = "macos")]
            {
                Some(("https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_macos", "yt-dlp_macos"))
            }
            #[cfg(target_os = "linux")]
            {
                Some(("https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp_linux", "yt-dlp_linux"))
            }
            #[cfg(target_os = "windows")]
            {
                Some(("https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.exe", "yt-dlp.exe"))
            }
            #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
            {
                None
            }
        }
    }
}

/// Get GitHub API URL for checking latest version of a channel
pub fn get_channel_api_url(channel: &YtdlpChannel) -> Option<&'static str> {
    match channel {
        YtdlpChannel::Bundled => None,
        YtdlpChannel::Stable => Some("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"),
        YtdlpChannel::Nightly => {
            Some("https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest")
        }
    }
}

/// Get the path to yt-dlp binary based on current channel setting
/// Returns: (path, is_bundled)
pub async fn get_ytdlp_path(app: &AppHandle) -> Option<(PathBuf, bool)> {
    let source = get_ytdlp_source(app).await;

    if source == DependencySource::System {
        return get_system_ytdlp_path().map(|p| (p, false));
    }

    let channel = get_ytdlp_channel(app).await;

    match channel {
        YtdlpChannel::Bundled => {
            // Bundled must mean the sidecar shipped with the current app build.
            // Keep the old app-data binary only as a compatibility fallback for
            // installs that predate the Youwee-specific sidecar name.
            if let Some(bundled) = get_bundled_ytdlp_path() {
                return Some((bundled, true));
            }
            if let Some(legacy_binary) = get_legacy_ytdlp_path(app) {
                return Some((legacy_binary, false));
            }
        }
        YtdlpChannel::Stable | YtdlpChannel::Nightly => {
            // Check channel-specific binary first
            if let Some(channel_path) = get_channel_binary_path(app, &channel) {
                if channel_path.exists() {
                    return Some((channel_path, false));
                }
            }
            // Fallback to bundled if channel binary not found
            if let Some(bundled) = get_bundled_ytdlp_path() {
                return Some((bundled, true));
            }
        }
    }

    // Final fallback: check app_data_dir/bin/yt-dlp (legacy location)
    if let Some(legacy_binary) = get_legacy_ytdlp_path(app) {
        return Some((legacy_binary, false));
    }

    None
}

/// Result of yt-dlp command with both stdout and stderr
pub struct YtdlpOutput {
    pub stdout: String,
    pub stderr: String,
    pub success: bool,
    /// Non-fatal findings detected on the success path, such as a download
    /// that completed but was silently limited to a low-resolution muxed
    /// format by YouTube age-gating.
    pub warnings: Vec<String>,
}

fn success_warnings(stderr: &str, format_selector: Option<&str>) -> Vec<String> {
    detect_age_restricted_silent_downgrade_from_stderr(stderr, format_selector)
        .map(|downgrade| vec![downgrade.message])
        .unwrap_or_default()
}

/// Helper to run yt-dlp command and get output with stderr
pub async fn run_ytdlp_with_stderr(app: &AppHandle, args: &[&str]) -> Result<YtdlpOutput, String> {
    let source = get_ytdlp_source(app).await;
    let format_selector = extract_format_selector(args);

    // Try to get yt-dlp path (prioritizes user-updated version)
    if let Some((binary_path, _)) = get_ytdlp_path(app).await {
        let mut cmd = Command::new(&binary_path);
        cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.hide_window();

        let output = cmd.output().await.map_err(|e| {
            BackendError::from_message(format!("Failed to run yt-dlp: {}", e)).to_wire_string()
        })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let success = output.status.success();
        let warnings = if success {
            success_warnings(&stderr, format_selector.as_deref())
        } else {
            Vec::new()
        };

        return Ok(YtdlpOutput {
            stdout,
            stderr,
            success,
            warnings,
        });
    }

    if source == DependencySource::System {
        return Err(BackendError::new(
            crate::types::code::YTDLP_SYSTEM_NOT_FOUND,
            system_ytdlp_not_found_message(),
        )
        .to_wire_string());
    }

    // Fallback to sidecar
    let sidecar_result = app.shell().sidecar("yt-dlp");

    match sidecar_result {
        Ok(sidecar) => {
            let (mut rx, _child) = sidecar.args(args).spawn().map_err(|e| {
                BackendError::from_message(format!("Failed to start yt-dlp: {}", e))
                    .to_wire_string()
            })?;

            let mut stdout = String::new();
            let mut stderr = String::new();
            let mut success = true;

            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        stdout.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    CommandEvent::Stderr(bytes) => {
                        stderr.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    CommandEvent::Error(err) => {
                        return Err(
                            BackendError::from_message(format!("Process error: {}", err))
                                .to_wire_string(),
                        );
                    }
                    CommandEvent::Terminated(status) => {
                        success = status.code == Some(0);
                    }
                    _ => {}
                }
            }

            let warnings = if success {
                success_warnings(&stderr, format_selector.as_deref())
            } else {
                Vec::new()
            };

            Ok(YtdlpOutput {
                stdout,
                stderr,
                success,
                warnings,
            })
        }
        Err(_) => {
            if source == DependencySource::Auto {
                let mut cmd = Command::new("yt-dlp");
                cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
                cmd.hide_window();

                let output = cmd.output().await.map_err(|e| {
                    BackendError::from_message(format!("Failed to run yt-dlp: {}", e))
                        .to_wire_string()
                })?;

                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let success = output.status.success();
                let warnings = if success {
                    success_warnings(&stderr, format_selector.as_deref())
                } else {
                    Vec::new()
                };

                Ok(YtdlpOutput {
                    stdout,
                    stderr,
                    success,
                    warnings,
                })
            } else {
                Err(BackendError::from_message(
                    "App-managed yt-dlp not found. Please install it from Settings > Dependencies.",
                )
                .to_wire_string())
            }
        }
    }
}

/// Parse yt-dlp stderr for common errors and return structured backend error
pub fn parse_ytdlp_error(stderr: &str) -> Option<BackendError> {
    let stderr_lower = stderr.to_lowercase();

    if is_upcoming_live_error(stderr) {
        return Some(
            BackendError::new(
                crate::types::code::YT_UPCOMING_LIVE,
                "This live event has not started yet. Try again after it starts, or enable Skip live streams.",
            )
            .with_retryable(false),
        );
    }

    // Age-restricted content: without account cookies YouTube only serves
    // low-resolution muxed formats (usually 360p) or refuses playback entirely.
    if is_age_restricted_error(stderr) {
        return Some(BackendError::from_message(
            "Age-restricted video detected. Without account cookies YouTube only serves low resolution (about 360p) or refuses the download. Enable cookies in Settings → Network (Cookie Mode) to unlock higher resolutions.",
        ));
    }

    // Browser cookie database locked / unavailable
    if stderr_lower.contains("could not copy")
        && stderr_lower.contains("cookie")
        && stderr_lower.contains("database")
    {
        return Some(
            BackendError::from_message(
                "Browser cookie database is locked. Please close browser windows and retry, or switch to Cookie File mode in Settings → Network."
            ),
        );
    }

    // Windows Chromium App-Bound Encryption / DPAPI cookie decryption failures
    if stderr_lower.contains("app-bound encryption")
        || stderr_lower.contains("app.bound.encryption")
        || stderr_lower.contains("failed to decrypt")
            && (stderr_lower.contains("dpapi") || stderr_lower.contains("cookie"))
        || stderr_lower.contains("could not decrypt")
            && (stderr_lower.contains("dpapi") || stderr_lower.contains("cookie"))
    {
        return Some(
            BackendError::from_message(
                "Browser cookie decryption failed on Windows. Chrome/Edge may be blocking cookie access. Please close the browser completely, use Firefox browser-cookie mode, or switch to Cookie File mode in Settings → Network."
            ),
        );
    }

    // Browser-cookie extraction failures
    if stderr_lower.contains("cookies from browser")
        && (stderr_lower.contains("failed")
            || stderr_lower.contains("unsupported")
            || stderr_lower.contains("cannot")
            || stderr_lower.contains("could not"))
    {
        return Some(
            BackendError::from_message(
                "Failed to read cookies from the selected browser profile. Please verify the browser/profile selection, close the browser completely, or switch to Cookie File mode in Settings → Network."
            ),
        );
    }

    // Cookie file path / format issues
    if stderr_lower.contains("cookie")
        && stderr_lower.contains("file")
        && (stderr_lower.contains("no such file")
            || stderr_lower.contains("not found")
            || stderr_lower.contains("cannot open")
            || stderr_lower.contains("permission denied")
            || stderr_lower.contains("invalid")
            || stderr_lower.contains("malformed"))
    {
        return Some(
            BackendError::from_message(
                "Cookie File mode is enabled, but the cookie file could not be read. Please verify that the file exists, is accessible, and is in Netscape cookies.txt format."
            ),
        );
    }

    // Douyin / TikTok fresh cookies requirement
    if stderr_lower.contains("fresh cookies")
        || (stderr_lower.contains("douyin")
            && stderr_lower.contains("cookies")
            && stderr_lower.contains("needed"))
    {
        return Some(
            BackendError::from_message(
                "This Douyin/TikTok content requires fresh login cookies. Please refresh login in browser cookie mode, then retry."
            ),
        );
    }

    // Rate limiting
    if stderr_lower.contains("429") || stderr_lower.contains("too many requests") {
        return Some(BackendError::from_message(
            "YouTube rate limited. Please wait a few minutes before trying again.",
        ));
    }

    // Video unavailable
    if stderr_lower.contains("video unavailable") {
        return Some(BackendError::from_message("This video is unavailable."));
    }

    // Private video - needs authentication
    if stderr_lower.contains("private video") {
        return Some(BackendError::from_message("This video is private. Please enable authentication in Settings → Video Authentication to access it."));
    }

    // Age restricted
    if stderr_lower.contains("age-restricted")
        || stderr_lower.contains("sign in to confirm your age")
    {
        return Some(BackendError::from_message("This video is age-restricted. Please enable authentication in Settings → Video Authentication to access it."));
    }

    // Members-only / subscription required
    if stderr_lower.contains("members-only")
        || stderr_lower.contains("member-only")
        || stderr_lower.contains("join this channel")
    {
        return Some(BackendError::from_message("This video is for channel members only. Please enable authentication in Settings → Video Authentication with a subscribed account."));
    }

    // Login required (generic)
    if stderr_lower.contains("sign in")
        || stderr_lower.contains("login required")
        || stderr_lower.contains("cookies") && stderr_lower.contains("required")
    {
        return Some(BackendError::from_message("This video requires sign-in. Please enable authentication in Settings → Video Authentication to access it."));
    }

    // Geographic restriction
    if stderr_lower.contains("not available in your country") || stderr_lower.contains("geo") {
        return Some(BackendError::from_message(
            "This video is not available in your region.",
        ));
    }

    // No subtitles
    if stderr_lower.contains("no subtitles") || stderr_lower.contains("subtitles are disabled") {
        return Some(BackendError::from_message(
            "This video has no subtitles available.",
        ));
    }

    // Network errors
    if stderr_lower.contains("unable to download") || stderr_lower.contains("connection") {
        if let Some(line) = stderr.lines().find(|l| l.to_lowercase().contains("error")) {
            return Some(BackendError::from_message(format!(
                "Download error: {}",
                line.trim()
            )));
        }
    }

    None
}

pub fn is_upcoming_live_error(stderr: &str) -> bool {
    let normalized = stderr.to_lowercase();
    normalized.contains("this live event will begin")
        || normalized.contains("premieres in")
        || normalized.contains("premiere will begin")
}

/// Detect age-restriction complaints from yt-dlp / YouTube stderr.
///
/// Age-restricted videos either fail outright with a sign-in requirement, or
/// silently fall back to low resolution (360p) muxed formats when no account
/// cookies are available. Surfacing this lets users enable cookie mode instead
/// of wondering why "best" quality came back as 360p.
pub fn is_age_restricted_error(stderr: &str) -> bool {
    let normalized = stderr.to_lowercase();
    normalized.contains("sign in to confirm your age")
        || normalized.contains("confirm your age")
        || normalized.contains("age-restricted")
        || normalized.contains("age restricted")
        || normalized.contains("inappropriate for some users")
        || normalized.contains("age-restriction")
}

/// Legacy muxed itags YouTube serves when the format list collapses for
/// anonymous clients. 17 = 144p 3gp, 36 = 180p 3gp, 18 = 360p mp4, 22 = 720p
/// mp4. When yt-dlp succeeds but every selected format is one of these, the
/// download went through with heavily limited quality.
pub const AGE_GATE_MUXED_ITAGS: &[&str] = &["17", "18", "22", "36"];

/// Outcome of a download that succeeded at a lower resolution than requested.
pub struct SilentDowngrade {
    /// Actual resolution label, e.g. "360p", for display on the queue item.
    pub resolution: String,
    /// User-facing guidance pointing to Cookie Mode.
    pub message: String,
}

/// Extract the requested format selector from yt-dlp args.
///
/// Looks for `-f <value>`, `--format <value>`, or their `=` variants and
/// returns the last occurrence, matching yt-dlp's own override semantics.
pub fn extract_format_selector(args: &[&str]) -> Option<String> {
    let mut selector = None;
    let mut index = 0;
    while index < args.len() {
        let arg = args[index];
        if arg == "-f" || arg == "--format" {
            if let Some(value) = args.get(index + 1) {
                selector = Some(value.to_string());
            }
            index += 2;
            continue;
        }
        if let Some(value) = arg.strip_prefix("--format=").or(arg.strip_prefix("-f=")) {
            selector = Some(value.to_string());
        }
        index += 1;
    }
    selector
}

/// Return the tightest explicit `height<=N` cap in a format selector.
pub fn requested_height_cap(selector: &str) -> Option<u32> {
    let marker = "height<=";
    let mut cap = None;
    let mut search_from = 0;
    while let Some(offset) = selector[search_from..].find(marker) {
        let value_start = search_from + offset + marker.len();
        let digits: String = selector[value_start..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if let Ok(value) = digits.parse::<u32>() {
            cap = Some(cap.map_or(value, |current: u32| current.min(value)));
        }
        search_from = value_start + digits.len().max(1);
    }
    cap
}

/// Whether a format selector can select a video stream.
///
/// Audio-only selectors such as `bestaudio/best` never pick a video stream, so
/// a low-resolution muxed fallback is not a resolution downgrade for them.
pub fn is_video_format_request(selector: &str) -> bool {
    selector.contains("bestvideo") || selector.contains("best[")
}

/// Parse the `[info] <id>: Downloading N format(s): a+b` line into format ids.
///
/// Returns `None` for any line that is not a format-selection report. Both the
/// single-format (`18`) and merged (`137+140`) shapes are handled.
pub fn extract_selected_format_ids(stderr_line: &str) -> Option<Vec<String>> {
    let marker = "format(s): ";
    let position = stderr_line.find(marker)?;
    let ids_part = stderr_line[position + marker.len()..].trim();
    if ids_part.is_empty() {
        return None;
    }

    let ids: Vec<String> = ids_part
        .split(['+', ',', ' '])
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect();

    if ids.is_empty() {
        None
    } else {
        Some(ids)
    }
}

/// Detect a successful download that was silently limited to a low-resolution
/// muxed format because YouTube collapsed the format list (typically
/// age-restriction without cookies).
///
/// `selected_ids_per_video` holds one entry per downloaded video. The warning
/// only fires when *every* video resolved to a legacy muxed itag: normal
/// videos resolve to adaptive pairs (e.g. `137+140`) even at 360p. When the
/// user explicitly requested 360p or lower, or the request is audio-only, no
/// warning is produced.
pub fn detect_age_restricted_silent_downgrade(
    selected_ids_per_video: &[Vec<String>],
    format_selector: Option<&str>,
) -> Option<SilentDowngrade> {
    if selected_ids_per_video.is_empty() {
        return None;
    }

    let mut all_muxed = true;
    let mut saw_360p_or_lower = false;
    let mut saw_720p = false;
    for ids in selected_ids_per_video {
        if ids.is_empty() {
            all_muxed = false;
            break;
        }
        for id in ids {
            if AGE_GATE_MUXED_ITAGS.contains(&id.as_str()) {
                if id == "22" {
                    saw_720p = true;
                } else {
                    saw_360p_or_lower = true;
                }
            } else {
                all_muxed = false;
                break;
            }
        }
        if !all_muxed {
            break;
        }
    }

    if !all_muxed {
        return None;
    }

    if let Some(selector) = format_selector {
        if !is_video_format_request(selector) {
            return None;
        }
        if let Some(cap) = requested_height_cap(selector) {
            if cap <= 360 {
                return None;
            }
        }
    }

    let resolution = if saw_720p && !saw_360p_or_lower {
        "720p"
    } else {
        "360p"
    };

    Some(SilentDowngrade {
        resolution: resolution.to_string(),
        message: format!(
            "Download finished, but YouTube only served a low-resolution format ({}). \
This can happen with age-restricted videos when cookies are disabled \
\u{2014} enable cookies in Settings \u{2192} Network (Cookie Mode) to unlock higher resolutions.",
            resolution
        ),
    })
}

/// Convenience wrapper that scans a full yt-dlp stderr for format-selection
/// lines before running the silent-downgrade detection.
pub fn detect_age_restricted_silent_downgrade_from_stderr(
    stderr: &str,
    format_selector: Option<&str>,
) -> Option<SilentDowngrade> {
    let selected: Vec<Vec<String>> = stderr
        .lines()
        .filter_map(extract_selected_format_ids)
        .collect();
    detect_age_restricted_silent_downgrade(&selected, format_selector)
}

/// Helper to run yt-dlp command and get JSON output
pub async fn run_ytdlp_json(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    let source = get_ytdlp_source(app).await;

    // Try to get yt-dlp path (prioritizes user-updated version)
    if let Some((binary_path, _)) = get_ytdlp_path(app).await {
        let mut cmd = Command::new(&binary_path);
        cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
        cmd.hide_window();

        let output = cmd.output().await.map_err(|e| {
            BackendError::from_message(format!("Failed to run yt-dlp: {}", e)).to_wire_string()
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if let Some(parsed_error) = parse_ytdlp_error(&stderr) {
                return Err(parsed_error.to_wire_string());
            }
            return Err(BackendError::from_message("yt-dlp command failed").to_wire_string());
        }

        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    if source == DependencySource::System {
        return Err(BackendError::new(
            crate::types::code::YTDLP_SYSTEM_NOT_FOUND,
            system_ytdlp_not_found_message(),
        )
        .to_wire_string());
    }

    // Fallback to sidecar
    let sidecar_result = app.shell().sidecar("yt-dlp");

    match sidecar_result {
        Ok(sidecar) => {
            let (mut rx, _child) = sidecar.args(args).spawn().map_err(|e| {
                BackendError::from_message(format!("Failed to start yt-dlp: {}", e))
                    .to_wire_string()
            })?;

            let mut output = String::new();
            let mut stderr_output = String::new();

            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        output.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    CommandEvent::Stderr(bytes) => {
                        stderr_output.push_str(&String::from_utf8_lossy(&bytes));
                    }
                    CommandEvent::Error(err) => {
                        return Err(
                            BackendError::from_message(format!("Process error: {}", err))
                                .to_wire_string(),
                        );
                    }
                    CommandEvent::Terminated(status) => {
                        if status.code != Some(0) {
                            // Parse stderr for user-friendly error
                            if let Some(parsed_error) = parse_ytdlp_error(&stderr_output) {
                                return Err(parsed_error.to_wire_string());
                            }
                            return Err(BackendError::from_message("yt-dlp command failed")
                                .to_wire_string());
                        }
                    }
                    _ => {}
                }
            }

            Ok(output)
        }
        Err(_) => {
            if source == DependencySource::Auto {
                let mut cmd = Command::new("yt-dlp");
                cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
                cmd.hide_window();

                let output = cmd.output().await.map_err(|e| {
                    BackendError::from_message(format!("Failed to run yt-dlp: {}", e))
                        .to_wire_string()
                })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    // Parse stderr for user-friendly error
                    if let Some(parsed_error) = parse_ytdlp_error(&stderr) {
                        return Err(parsed_error.to_wire_string());
                    }
                    return Err(
                        BackendError::from_message("yt-dlp command failed").to_wire_string()
                    );
                }

                Ok(String::from_utf8_lossy(&output.stdout).to_string())
            } else {
                Err(BackendError::from_message(
                    "App-managed yt-dlp not found. Please install it from Settings > Dependencies.",
                )
                .to_wire_string())
            }
        }
    }
}

/// Get yt-dlp version
pub async fn get_ytdlp_version_internal(app: &AppHandle) -> Result<YtdlpVersionInfo, String> {
    let source = get_ytdlp_source(app).await;

    // Try to get yt-dlp path (prioritizes user-updated version)
    if let Some((binary_path, is_bundled)) = get_ytdlp_path(app).await {
        let mut cmd = Command::new(&binary_path);
        cmd.args(["--version"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd.hide_window();

        let output = cmd.output().await.map_err(|e| {
            BackendError::from_message(format!("Failed to run yt-dlp: {}", e)).to_wire_string()
        })?;

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let bin_path = binary_path.to_string_lossy().to_string();

        return Ok(YtdlpVersionInfo {
            version,
            latest_version: None,
            update_available: false,
            is_bundled,
            binary_path: bin_path,
        });
    }

    if source == DependencySource::System {
        return Err(BackendError::new(
            crate::types::code::YTDLP_SYSTEM_NOT_FOUND,
            system_ytdlp_not_found_message(),
        )
        .to_wire_string());
    }

    // Fallback to sidecar
    let sidecar_result = app.shell().sidecar("yt-dlp");

    let (version, is_bundled, binary_path) = match sidecar_result {
        Ok(sidecar) => {
            let (mut rx, _child) = sidecar.args(["--version"]).spawn().map_err(|e| {
                BackendError::from_message(format!("Failed to start yt-dlp: {}", e))
                    .to_wire_string()
            })?;

            let mut output = String::new();
            while let Some(event) = rx.recv().await {
                if let CommandEvent::Stdout(bytes) = event {
                    output.push_str(&String::from_utf8_lossy(&bytes));
                }
            }

            let version = output.trim().to_string();
            let resource_dir = app.path().resource_dir().ok();
            let bin_path = resource_dir
                .map(|p| p.join("bin").join("yt-dlp").to_string_lossy().to_string())
                .unwrap_or_else(|| "bundled".to_string());

            (version, true, bin_path)
        }
        Err(_) => {
            if source != DependencySource::Auto {
                return Err(BackendError::new(
                    crate::types::code::YTDLP_APP_NOT_FOUND,
                    "App-managed yt-dlp not found. Please install it from Settings > Dependencies.",
                )
                .with_retryable(false)
                .to_wire_string());
            }

            let mut cmd = Command::new("yt-dlp");
            cmd.args(["--version"])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            cmd.hide_window();

            let output = cmd.output().await.map_err(|e| {
                BackendError::from_message(format!("yt-dlp not found: {}", e)).to_wire_string()
            })?;

            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();

            let bin_path = get_system_ytdlp_path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "system".to_string());

            (version, false, bin_path)
        }
    };

    Ok(YtdlpVersionInfo {
        version,
        latest_version: None,
        update_available: false,
        is_bundled,
        binary_path,
    })
}

/// Get the appropriate download URL and binary name for current platform
/// Note: yt-dlp_macos is a Universal Binary that works on both Intel and Apple Silicon
/// Using stable releases for reliability
pub fn get_ytdlp_download_info() -> (&'static str, &'static str, &'static str) {
    #[cfg(target_os = "macos")]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos",
            "yt-dlp",
            "yt-dlp_macos",
        )
    }
    #[cfg(target_os = "linux")]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux",
            "yt-dlp",
            "yt-dlp_linux",
        )
    }
    #[cfg(target_os = "windows")]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe",
            "yt-dlp.exe",
            "yt-dlp.exe",
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        (
            "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp",
            "yt-dlp",
            "yt-dlp",
        )
    }
}

/// Verify SHA256 checksum
pub fn verify_sha256(data: &[u8], expected_hash: &str) -> bool {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let computed_hash = hex::encode(result);
    computed_hash.eq_ignore_ascii_case(expected_hash)
}

/// Build cookie args for yt-dlp based on cookie settings
pub fn build_cookie_args(
    url: &str,
    cookie_mode: Option<&str>,
    cookie_browser: Option<&str>,
    cookie_browser_profile: Option<&str>,
    cookie_file_path: Option<&str>,
    cookie_skip_patterns: Option<&[String]>,
) -> Vec<String> {
    let mut args = Vec::new();

    if cookie_skip_patterns
        .map(|patterns| should_skip_cookies_for_url(url, patterns))
        .unwrap_or(false)
    {
        return args;
    }

    let mode = cookie_mode.unwrap_or("off");
    match mode {
        "browser" => {
            if let Some(browser) = cookie_browser {
                let mut cookie_arg = browser.to_string();
                if let Some(profile) = cookie_browser_profile {
                    if !profile.is_empty() {
                        let profile = if browser.eq_ignore_ascii_case("firefox") {
                            resolve_firefox_profile_for_cookies(profile)
                        } else {
                            profile.to_string()
                        };
                        cookie_arg = format!("{}:{}", browser, profile);
                    }
                }
                args.push("--cookies-from-browser".to_string());
                args.push(cookie_arg);
            }
        }
        "file" => {
            if let Some(file_path) = cookie_file_path {
                if !file_path.is_empty() {
                    args.push("--cookies".to_string());
                    args.push(file_path.to_string());
                }
            }
        }
        _ => {}
    }

    args
}

pub use crate::utils::add_safe_filename_args;

fn parse_cookie_skip_rule(rule: &str) -> Option<(String, String)> {
    let trimmed = rule.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed.trim_start_matches('/'))
    };

    let parsed = reqwest::Url::parse(&normalized).ok()?;
    let host = parsed.host_str()?.trim().to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }

    let path = parsed.path().trim_end_matches('/').to_string();
    let path = if path.is_empty() {
        "/".to_string()
    } else {
        path
    };

    Some((host, path))
}

fn host_matches_cookie_skip_rule(url_host: &str, rule_host: &str) -> bool {
    url_host == rule_host
        || url_host
            .strip_suffix(rule_host)
            .map(|prefix| prefix.ends_with('.'))
            .unwrap_or(false)
}

fn path_matches_cookie_skip_rule(url_path: &str, rule_path: &str) -> bool {
    if rule_path == "/" {
        return true;
    }

    url_path == rule_path
        || url_path
            .strip_prefix(rule_path)
            .map(|suffix| suffix.starts_with('/'))
            .unwrap_or(false)
}

pub fn should_skip_cookies_for_url(url: &str, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }

    let Ok(parsed_url) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(url_host) = parsed_url.host_str().map(|host| host.to_ascii_lowercase()) else {
        return false;
    };
    let url_path = parsed_url.path().trim_end_matches('/');
    let url_path = if url_path.is_empty() { "/" } else { url_path };

    patterns.iter().any(|rule| {
        let Some((rule_host, rule_path)) = parse_cookie_skip_rule(rule) else {
            return false;
        };

        host_matches_cookie_skip_rule(&url_host, &rule_host)
            && path_matches_cookie_skip_rule(url_path, &rule_path)
    })
}

/// Build proxy args for yt-dlp based on proxy URL
/// Supports HTTP and SOCKS5 proxies with optional authentication
/// Format: http://host:port, http://user:pass@host:port, socks5://host:port, socks5://user:pass@host:port
pub fn build_proxy_args(proxy_url: Option<&str>) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(url) = proxy_url {
        if !url.is_empty() && url != "off" {
            args.push("--proxy".to_string());
            args.push(url.to_string());
        }
    }

    args
}

/// Build site-specific request header args for yt-dlp.
///
/// Bilibili may reject the initial webpage request with HTTP 412 unless the
/// request looks like it came from a browser.
pub fn build_site_header_args(url: &str) -> Vec<String> {
    if is_bilibili_host(url) {
        return vec![
            "--user-agent".to_string(),
            BILIBILI_USER_AGENT.to_string(),
            "--referer".to_string(),
            BILIBILI_REFERER.to_string(),
        ];
    }

    Vec::new()
}

fn is_bilibili_host(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };

    let Some(host) = parsed.host_str().map(|host| host.to_ascii_lowercase()) else {
        return false;
    };

    host == "b23.tv" || host == "bilibili.com" || host.ends_with(".bilibili.com")
}

fn ytdlp_url_arg(args: &[&str]) -> Option<String> {
    args.iter()
        .position(|arg| *arg == "--")
        .and_then(|separator_index| args.get(separator_index + 1))
        .map(|url| (*url).to_string())
}

/// Merge extra yt-dlp arguments while preserving `-- <url>` ordering.
/// If `base_args` contains `--`, all extra options must be inserted before it.
fn merge_ytdlp_args(base_args: &[&str], extra_args: &[String]) -> Vec<String> {
    let mut merged: Vec<String> = base_args.iter().map(|s| s.to_string()).collect();
    if extra_args.is_empty() {
        return merged;
    }

    if let Some(separator_index) = merged.iter().position(|arg| arg == "--") {
        merged.splice(separator_index..separator_index, extra_args.iter().cloned());
    } else {
        merged.extend(extra_args.iter().cloned());
    }

    merged
}

/// Helper to run yt-dlp command with cookie and proxy support and get JSON output
pub async fn run_ytdlp_json_with_cookies(
    app: &AppHandle,
    base_args: &[&str],
    cookie_mode: Option<&str>,
    cookie_browser: Option<&str>,
    cookie_browser_profile: Option<&str>,
    cookie_file_path: Option<&str>,
    cookie_skip_patterns: Option<&[String]>,
    proxy_url: Option<&str>,
) -> Result<String, String> {
    // Build full args with site headers, cookies and proxy
    let url = ytdlp_url_arg(base_args);
    let site_header_args = url
        .as_deref()
        .map(build_site_header_args)
        .unwrap_or_default();
    let cookie_args = build_cookie_args(
        url.as_deref().unwrap_or_default(),
        cookie_mode,
        cookie_browser,
        cookie_browser_profile,
        cookie_file_path,
        cookie_skip_patterns,
    );
    let proxy_args = build_proxy_args(proxy_url);
    let mut extra_args = Vec::new();
    extra_args.extend(site_header_args);
    extra_args.extend(cookie_args);
    extra_args.extend(proxy_args);
    let args = merge_ytdlp_args(base_args, &extra_args);

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    run_ytdlp_json(app, &args_ref).await
}

/// Helper to run yt-dlp command with cookie and proxy support and get output with stderr
pub async fn run_ytdlp_with_stderr_and_cookies(
    app: &AppHandle,
    base_args: &[&str],
    cookie_mode: Option<&str>,
    cookie_browser: Option<&str>,
    cookie_browser_profile: Option<&str>,
    cookie_file_path: Option<&str>,
    cookie_skip_patterns: Option<&[String]>,
    proxy_url: Option<&str>,
) -> Result<YtdlpOutput, String> {
    // Build full args with site headers, cookies and proxy
    let url = ytdlp_url_arg(base_args);
    let site_header_args = url
        .as_deref()
        .map(build_site_header_args)
        .unwrap_or_default();
    let cookie_args = build_cookie_args(
        url.as_deref().unwrap_or_default(),
        cookie_mode,
        cookie_browser,
        cookie_browser_profile,
        cookie_file_path,
        cookie_skip_patterns,
    );
    let proxy_args = build_proxy_args(proxy_url);
    let mut extra_args = Vec::new();
    extra_args.extend(site_header_args);
    extra_args.extend(cookie_args);
    extra_args.extend(proxy_args);
    let args = merge_ytdlp_args(base_args, &extra_args);

    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    run_ytdlp_with_stderr(app, &args_ref).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_site_header_args_adds_bilibili_headers() {
        let args = build_site_header_args("https://www.bilibili.com/video/BV1Qo4y1s7XT");

        assert_eq!(
            args,
            vec![
                "--user-agent".to_string(),
                BILIBILI_USER_AGENT.to_string(),
                "--referer".to_string(),
                BILIBILI_REFERER.to_string(),
            ]
        );
    }

    #[test]
    fn build_site_header_args_adds_b23_headers() {
        let args = build_site_header_args("https://b23.tv/abc123");

        assert_eq!(args.len(), 4);
        assert_eq!(args[0], "--user-agent");
        assert_eq!(args[2], "--referer");
    }

    #[test]
    fn build_site_header_args_ignores_other_sites() {
        assert!(build_site_header_args("https://www.youtube.com/watch?v=abc").is_empty());
    }

    #[test]
    fn build_site_header_args_ignores_bilibili_text_outside_host() {
        assert!(build_site_header_args("https://example.com/watch?url=bilibili.com").is_empty());
    }

    #[test]
    fn cookie_skip_rule_matches_host_and_path_prefix() {
        let rules = vec!["facebook.com/reel".to_string()];

        assert!(should_skip_cookies_for_url(
            "https://www.facebook.com/reel/1889836315019111?x=1",
            &rules,
        ));
        assert!(should_skip_cookies_for_url(
            "https://m.facebook.com/reel/1889836315019111",
            &rules,
        ));
        assert!(!should_skip_cookies_for_url(
            "https://www.facebook.com/watch/?v=1889836315019111",
            &rules,
        ));
        assert!(!should_skip_cookies_for_url(
            "https://notfacebook.com/reel/1889836315019111",
            &rules,
        ));
    }

    #[test]
    fn cookie_skip_rule_can_match_whole_domain() {
        let rules = vec!["facebook.com".to_string()];

        assert!(should_skip_cookies_for_url(
            "https://www.facebook.com/watch/?v=1889836315019111",
            &rules,
        ));
        assert!(should_skip_cookies_for_url(
            "https://m.facebook.com/reel/1889836315019111",
            &rules,
        ));
        assert!(!should_skip_cookies_for_url(
            "https://facebook.com.evil.test/reel/1889836315019111",
            &rules,
        ));
    }

    #[test]
    fn safe_filename_args_trim_long_titles_before_writing_files() {
        let mut args = vec!["--newline".to_string()];

        add_safe_filename_args(&mut args, None);

        assert!(args.contains(&"--newline".to_string()));
        assert!(args.contains(&"--trim-filenames".to_string()));
        #[cfg(windows)]
        assert!(args.contains(&"--windows-filenames".to_string()));
    }

    #[test]
    fn parse_ytdlp_error_detects_upcoming_live() {
        let error = parse_ytdlp_error(
            "ERROR: [youtube] p_k8zlee-kQ: This live event will begin in 3 hours.",
        )
        .expect("upcoming live error should be parsed");

        assert_eq!(error.code(), crate::types::code::YT_UPCOMING_LIVE);
        assert_eq!(error.to_wire().retryable, Some(false));
    }

    #[test]
    fn is_upcoming_live_error_detects_premiere_messages() {
        assert!(is_upcoming_live_error(
            "ERROR: [youtube] abc: This video premieres in 2 hours."
        ));
        assert!(is_upcoming_live_error(
            "ERROR: [youtube] abc: The premiere will begin shortly."
        ));
    }

    #[test]
    fn is_age_restricted_error_detects_age_gate_messages() {
        assert!(is_age_restricted_error(
            "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users."
        ));
        assert!(is_age_restricted_error(
            "WARNING: [youtube] abc: This video is age-restricted and only low resolution formats are available without cookies."
        ));
        assert!(is_age_restricted_error(
            "ERROR: [youtube] abc: This video is age restricted."
        ));
        assert!(!is_age_restricted_error(
            "ERROR: [youtube] abc: Video unavailable."
        ));
    }

    #[test]
    fn parse_ytdlp_error_guides_to_cookies_for_age_restriction() {
        let error = parse_ytdlp_error(
            "ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.",
        )
        .expect("age-restricted error should be parsed");

        assert!(error.message().to_lowercase().contains("cookie"));
        assert!(error
            .message()
            .to_lowercase()
            .contains("age-restricted video detected"));
    }

    #[test]
    fn extract_format_selector_reads_dash_f_value() {
        let args = [
            "--newline",
            "-f",
            "bestvideo+bestaudio/best",
            "https://x.test",
        ];

        assert_eq!(
            extract_format_selector(&args).as_deref(),
            Some("bestvideo+bestaudio/best")
        );
        assert_eq!(extract_format_selector(&["--newline"]), None);
    }

    #[test]
    fn extract_format_selector_reads_inline_forms_and_last_wins() {
        let args = ["-f=first", "--format=second"];

        assert_eq!(extract_format_selector(&args).as_deref(), Some("second"));
    }

    #[test]
    fn requested_height_cap_finds_tightest_bound() {
        let selector = "bestvideo[height<=1080][ext=mp4]+bestaudio/best[height<=720]/best";

        assert_eq!(requested_height_cap(selector), Some(720));
        assert_eq!(requested_height_cap("bestvideo+bestaudio/best"), None);
    }

    #[test]
    fn extract_selected_format_ids_parses_info_lines() {
        assert_eq!(
            extract_selected_format_ids("[info] aBcD1234: Downloading 1 format(s): 18"),
            Some(vec!["18".to_string()])
        );
        assert_eq!(
            extract_selected_format_ids("[info] aBcD1234: Downloading 2 format(s): 137+140"),
            Some(vec!["137".to_string(), "140".to_string()])
        );
        assert_eq!(
            extract_selected_format_ids("[download] Destination: video.mp4"),
            None
        );
    }

    #[test]
    fn silent_downgrade_regression_warns_for_muxed_360p_success() {
        // Regression for the #128 success path: yt-dlp exits 0 but the only
        // format served to the anonymous client is the 360p muxed itag.
        let stderr = "[info] aBcD1234: Downloading 1 format(s): 18\n\
                      [download] Destination: /tmp/video.mp4\n\
                      [download] 100% of 12.34MiB in 00:00:05";

        let downgrade = detect_age_restricted_silent_downgrade_from_stderr(
            stderr,
            Some("bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"),
        )
        .expect("silent 360p downgrade should be detected");

        assert_eq!(downgrade.resolution, "360p");
        assert!(downgrade.message.contains("360p"));
        assert!(downgrade.message.to_lowercase().contains("cookie"));
    }

    #[test]
    fn silent_downgrade_ignores_adaptive_format_selection() {
        let stderr = "[info] aBcD1234: Downloading 2 format(s): 137+140";

        assert!(detect_age_restricted_silent_downgrade_from_stderr(stderr, None).is_none());
    }

    #[test]
    fn silent_downgrade_respects_requested_360p() {
        let stderr = "[info] aBcD1234: Downloading 1 format(s): 18";

        assert!(detect_age_restricted_silent_downgrade_from_stderr(
            stderr,
            Some("bestvideo[height<=360]+bestaudio/best[height<=360]/best"),
        )
        .is_none());
    }

    #[test]
    fn silent_downgrade_ignores_audio_only_requests() {
        let stderr = "[info] aBcD1234: Downloading 1 format(s): 18";

        assert!(detect_age_restricted_silent_downgrade_from_stderr(
            stderr,
            Some("bestaudio[ext=m4a]/bestaudio/best"),
        )
        .is_none());
    }

    #[test]
    fn silent_downgrade_requires_every_video_to_be_limited() {
        // Playlist where one video resolved normally: no warning.
        let mixed = [
            vec!["18".to_string()],
            vec!["137".to_string(), "140".to_string()],
        ];

        assert!(detect_age_restricted_silent_downgrade(&mixed, None).is_none());

        let limited = [vec!["18".to_string()], vec!["18".to_string()]];
        let downgrade =
            detect_age_restricted_silent_downgrade(&limited, Some("bestvideo+bestaudio/best"))
                .expect("fully limited playlist should warn");

        assert_eq!(downgrade.resolution, "360p");
    }

    #[test]
    fn silent_downgrade_reports_720p_hint_for_itag_22() {
        let limited = [vec!["22".to_string()]];

        let downgrade =
            detect_age_restricted_silent_downgrade(&limited, Some("bestvideo+bestaudio/best"))
                .expect("single muxed 720p selection should warn");

        assert_eq!(downgrade.resolution, "720p");
    }

    #[test]
    fn merge_ytdlp_args_inserts_extra_args_before_url_separator() {
        let base_args = ["--dump-json", "--", "https://www.bilibili.com/video/BV"];
        let extra_args = build_site_header_args("https://www.bilibili.com/video/BV");
        let merged = merge_ytdlp_args(&base_args, &extra_args);

        let separator_index = merged.iter().position(|arg| arg == "--").unwrap();
        assert_eq!(
            merged[separator_index + 1],
            "https://www.bilibili.com/video/BV"
        );
        assert!(merged[..separator_index].contains(&"--user-agent".to_string()));
        assert!(merged[..separator_index].contains(&"--referer".to_string()));
    }
}
