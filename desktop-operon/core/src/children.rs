//! children.rs — the host's muscle: long-lived child-process supervision.
//!
//! The operon `run()` builtin caps children at a 5-minute wall clock BY
//! DESIGN (sec-r2 containment: a fuel-blind child was a whole-program DoS).
//! That cap is exactly right for a language runtime and exactly wrong for a
//! downloader whose yt-dlp child legitimately runs for many minutes. The
//! fix lives HERE, in the capability-granting host: the host spawns and
//! supervises the long effectors itself (no timeout — a real desktop app
//! owns its children), and streams every progress line back into the
//! operon brain, where all the DECISIONS still happen.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub enum Ev {
    /// one stdout progress line from a download child
    Line { job: String, line: String },
    /// final stderr tail (last chunk before the pipe closed)
    ErrTail { job: String, tail: String },
    /// child exited (the host translates this into dl_on_exit / dl_on_meta)
    Exit { job: String, code: i32 },
    /// full stdout body of a metadata fetch (-J dumps one big JSON)
    MetaBody { job: String, body: String },
    /// folder picker answered
    FolderPick(Option<String>),
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Meta,
    Download,
}

struct Spawned {
    kill: Arc<Mutex<Child>>,
}

pub struct Supervisor {
    tx: Sender<Ev>,
    rx: Receiver<Ev>,
    procs: HashMap<String, Spawned>,
}

const META_CAP: usize = 64 * 1024 * 1024; // yt-dlp -J bodies can be large
const LINE_CAP: usize = 8 * 1024;
const ERR_TAIL_CAP: usize = 16 * 1024;

const FOLDER_PS: &str = "Add-Type -AssemblyName System.Windows.Forms; \
$f = New-Object System.Windows.Forms.FolderBrowserDialog; \
$f.Description = 'Choose the Youwee Operon download folder'; \
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }";

impl Supervisor {
    pub fn new() -> Supervisor {
        let (tx, rx) = mpsc::channel();
        Supervisor {
            tx,
            rx,
            procs: HashMap::new(),
        }
    }

    pub fn spawn(
        &mut self,
        id: &str,
        argv: &[String],
        kind: Kind,
        prepend_path: Option<&std::path::Path>,
    ) -> bool {
        if argv.is_empty() {
            return false;
        }
        let mut cmd = Command::new(&argv[0]);
        cmd.args(&argv[1..]);
        // the bundled aria2 dir goes on the CHILD's PATH so yt-dlp finds
        // aria2c without the user installing anything (PATH is inherited,
        // so the user's own yt-dlp/ffmpeg stay exactly where they are)
        if let Some(p) = prepend_path {
            let sep = if cfg!(windows) { ";" } else { ":" };
            let existing = std::env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{}{}{}", p.display(), sep, existing));
        }
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = self.tx.send(Ev::ErrTail {
                    job: id.to_string(),
                    tail: format!("cannot start '{}': {}", argv[0], e),
                });
                let _ = self.tx.send(Ev::Exit {
                    job: id.to_string(),
                    code: 127,
                });
                return false;
            }
        };
        let mut stdout = child.stdout.take();
        let mut stderr = child.stderr.take();
        let kill = Arc::new(Mutex::new(child));
        let tx = self.tx.clone();
        let job = id.to_string();

        // stdout lane
        let tx_so = tx.clone();
        let job_so = job.clone();
        let k_so = Arc::clone(&kill);
        std::thread::Builder::new()
            .name(format!("yw-so-{}", job))
            .spawn(move || match kind {
                Kind::Meta => {
                    let mut buf: Vec<u8> = Vec::new();
                    if let Some(mut s) = stdout.take() {
                        let mut chunk = [0u8; 65536];
                        loop {
                            match s.read(&mut chunk) {
                                Ok(0) => break,
                                Ok(n) => {
                                    buf.extend_from_slice(&chunk[..n]);
                                    if buf.len() > META_CAP {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                    let body = String::from_utf8_lossy(&buf).to_string();
                    let _ = tx_so.send(Ev::MetaBody { job: job_so, body });
                }
                Kind::Download => {
                    if let Some(s) = stdout.take() {
                        let rdr = BufReader::new(s);
                        for line in rdr.lines() {
                            match line {
                                Ok(l) => {
                                    if l.len() > LINE_CAP {
                                        continue;
                                    }
                                    if tx_so
                                        .send(Ev::Line {
                                            job: job_so.clone(),
                                            line: l,
                                        })
                                        .is_err()
                                    {
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                }
            })
            .ok();

        // stderr lane: keep only the last chunk (error reporting + logs)
        let tx_se = tx.clone();
        let job_se = job.clone();
        std::thread::Builder::new()
            .name(format!("yw-se-{}", job))
            .spawn(move || {
                let mut buf: Vec<u8> = Vec::new();
                if let Some(s) = stderr.as_mut() {
                    let mut chunk = [0u8; 8192];
                    loop {
                        match s.read(&mut chunk) {
                            Ok(0) => break,
                            Ok(n) => {
                                buf.extend_from_slice(&chunk[..n]);
                                if buf.len() > 1024 * 1024 {
                                    buf.drain(..buf.len() / 2);
                                }
                            }
                            Err(_) => break,
                        }
                    }
                }
                let start = buf.len().saturating_sub(ERR_TAIL_CAP);
                let tail = String::from_utf8_lossy(&buf[start..]).to_string();
                let _ = tx_se.send(Ev::ErrTail { job: job_se, tail });
            })
            .ok();

        // reaper: poll-wait so a cancel can lock the child and kill it
        let tx_w = tx;
        let job_w = job.clone();
        std::thread::Builder::new()
            .name(format!("yw-wait-{}", job_w))
            .spawn(move || loop {
                {
                    let mut c = match k_so.lock() {
                        Ok(c) => c,
                        Err(_) => return,
                    };
                    match c.try_wait() {
                        Ok(Some(status)) => {
                            let code = status.code().unwrap_or(-1);
                            let _ = tx_w.send(Ev::Exit { job: job_w, code });
                            return;
                        }
                        Ok(None) => {}
                        Err(_) => return,
                    }
                }
                std::thread::sleep(Duration::from_millis(120));
            })
            .ok();

        self.procs.insert(
            id.to_string(),
            Spawned {
                kill: Arc::clone(&kill),
            },
        );
        true
    }

    /// Ask a child to die (the operon registry already flagged it cancelling;
    /// the eventual Exit event carries the final state through dl_on_exit).
    pub fn kill(&mut self, id: &str) {
        if let Some(sp) = self.procs.get(id) {
            if let Ok(mut c) = sp.kill.lock() {
                let _ = c.kill();
            }
        }
    }

    pub fn alive(&self, id: &str) -> bool {
        self.procs.contains_key(id)
    }

    /// Drain every event that arrived since the last call (GUI-frame pump).
    pub fn poll(&mut self) -> Vec<Ev> {
        let mut out = Vec::new();
        while let Ok(ev) = self.rx.try_recv() {
            if let Ev::Exit { job, .. } = &ev {
                self.procs.remove(job);
            }
            out.push(ev);
        }
        out
    }

    /// Native Windows folder picker via PowerShell (zero extra crates).
    pub fn pick_folder(&self) {
        let tx = self.tx.clone();
        std::thread::Builder::new()
            .name("yw-folder".to_string())
            .spawn(move || {
                let out = Command::new("powershell")
                    .args(["-NoProfile", "-STA", "-Command", FOLDER_PS])
                    .output();
                let picked = match out {
                    Ok(o) if o.status.code() == Some(0) => {
                        let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        if s.is_empty() {
                            None
                        } else {
                            Some(s)
                        }
                    }
                    _ => None,
                };
                let _ = tx.send(Ev::FolderPick(picked));
            })
            .ok();
    }
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::new()
    }
}
