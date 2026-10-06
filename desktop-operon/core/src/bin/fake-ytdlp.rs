//! fake-ytdlp — a tiny cross-platform stand-in for yt-dlp, used by the
//! end-to-end flow test (tests/flow.rs). The regression guards the old
//! TubeForge/neuron-yt breakage class: a download child that runs LONGER
//! than the interpreter's run() containment cap must still complete, because
//! the host (not operon) owns the long-lived child.
//!
//! Modes:
//!   --version            -> prints "2026.10.06-fake"
//!   -J <url>             -> prints the metadata JSON document
//!   anything else        -> download mode: streams three progress lines,
//!                           one per second, then the 100% line, exit 0

use std::io::Write;

fn out(line: &str) {
    // stdout is block-buffered when piped — flush EVERY line or the
    // supervisor's progress lane sees nothing until exit
    let mut so = std::io::stdout();
    let _ = so.write_all(line.as_bytes());
    let _ = so.write_all(b"\n");
    let _ = so.flush();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.iter().any(|a| a == "--version") {
        out("2026.10.06-fake");
        std::process::exit(0);
    }

    if args.len() >= 2 && args[1] == "-J" {
        out(
            "{\"title\":\"Flow Test\",\"uploader\":\"u\",\"duration\":42,\
             \"webpage_url\":\"https://x.test/v\",\"formats\":[\
             {\"format_id\":\"F137\",\"ext\":\"mp4\",\"height\":1080,\
             \"vcodec\":\"avc1\",\"acodec\":\"none\",\"filesize\":10485760}]}",
        );
        std::process::exit(0);
    }

    // download mode: ~3 s of progress. The POINT of the regression is that
    // this child OUTLIVES anything the interpreter's run() would allow and
    // still completes, because the HOST (children.rs supervisor) owns it.
    for i in 1..=3 {
        out(&format!(
            "[download]  {}.0% of ~ 10.00MiB at 1.00MiB/s ETA 00:0{}",
            i * 30,
            3 - i
        ));
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    out("[download] 100% of 10.00MiB in 00:03");
    std::process::exit(0);
}
