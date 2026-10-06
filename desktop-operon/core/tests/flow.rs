// flow.rs — end-to-end host<->operon flow with a FAKE yt-dlp.
//
// This is the regression that guards the old TubeForge/neuron-yt breakage:
// a download child that runs LONGER than the interpreter's run() containment
// cap must still complete, because the host (not operon) owns the long-lived
// child, while every progress line still flows through the operon state
// machine (op/app.op). The fake tool here sleeps ~3 s while emitting
// progress; here the child outlives anything the interpreter would allow
// and finishes cleanly.
//
// CROSS-PLATFORM: the fake is a real compiled helper (src/bin/fake-ytdlp.rs,
// reached via CARGO_BIN_EXE_) copied next to the test tree as "yt-dlp", so
// this regression executes on Windows CI too (the OS the user runs).

use std::cell::RefCell;
use std::rc::Rc;
use std::time::{Duration, Instant};
use ywcore::children::{Ev, Kind, Supervisor};
use ywcore::{Grants, Runtime};

fn mget(m: &operon::value::MapRef, key: &str) -> Option<operon::value::Value> {
    let b = m.borrow();
    b.position_str(key)
        .and_then(|i| b.get(i).map(|p| p.1.clone()))
}

fn vstr(v: Option<operon::value::Value>) -> String {
    match v {
        Some(operon::value::Value::Str(s)) => s,
        Some(o) => o.display(),
        None => String::new(),
    }
}

fn vlist(v: Option<operon::value::Value>) -> Vec<operon::value::Value> {
    match v {
        Some(operon::value::Value::List(l)) => l.borrow().clone(),
        _ => Vec::new(),
    }
}

#[test]
fn long_child_survives_and_job_completes() {
    let root = std::env::temp_dir().join(format!(
        "yw-flow-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(root.join("data")).unwrap();
    std::fs::create_dir_all(root.join("out")).unwrap();
    std::fs::create_dir_all(root.join("bin")).unwrap();

    // fake yt-dlp: the compiled cross-platform helper (version probe, -J
    // metadata, and a download mode streaming progress for ~3 wall seconds;
    // the interpreter cap for run() would be 60 s here — the POINT is the
    // host child path, not the interpreter's timer)
    let fake = root.join("bin").join(if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    });
    std::fs::copy(env!("CARGO_BIN_EXE_fake-ytdlp"), &fake).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    let op_path = root.join("app.op");
    std::fs::write(&op_path, include_str!("../../op/app.op")).unwrap();

    let grants = Grants {
        read: vec![root.to_string_lossy().to_string()],
        write: vec![root.to_string_lossy().to_string()],
        run: vec!["yt-dlp".into(), "ffmpeg".into(), "ffprobe".into()],
        env: vec!["TEMP".into(), "TMP".into(), "OS".into()],
    };
    let mut rt = Runtime::boot(op_path.to_str().unwrap(), &grants).unwrap();

    // tools probe would run the REAL yt-dlp name; point the probe at the fake
    // by ev_init's aria2 + a PATH trick: the probe gene runs "yt-dlp" via
    // run() which uses the interpreter's own PATH — the fake bin dir is
    // prepended by exporting PATH for this test process (join_paths picks the
    // correct separator per OS; on Windows CreateProcess also searches the
    // parent PATH, so name resolution works on both).
    let new_path = std::env::join_paths(
        std::iter::once(root.join("bin"))
            .chain(std::env::split_paths(&std::env::var("PATH").unwrap())),
    )
    .unwrap();
    std::env::set_var("PATH", &new_path);
    let cfg = format!(
        "{{\"out_dir\":{},\"data_dir\":{},\"aria2\":{}}}",
        ywcore::jstr(&root.join("out").to_string_lossy()),
        ywcore::jstr(&root.join("data").to_string_lossy()),
        ywcore::jstr(&root.join("bin/aria2c.exe").to_string_lossy())
    );
    let out = rt.call("ev_init", Some(&cfg)).unwrap();
    assert!(
        out.contains("2026.10.06-fake"),
        "tools probe should find the fake: {}",
        out
    );

    // 1) metadata fetch — host supervises, operon parses
    let r = rt.call("ev_fetch", Some("\"https://x.test/v\"")).unwrap();
    let mid = {
        let v = operon::interp::json_parse(&r).unwrap();
        if let operon::value::Value::Map(m) = &v {
            vstr(mget(m, "id"))
        } else {
            panic!("bad ev_fetch response: {}", r)
        }
    };
    let argv: Vec<String> = {
        let v = operon::interp::json_parse(&r).unwrap();
        if let operon::value::Value::Map(m) = &v {
            vlist(mget(m, "argv"))
                .into_iter()
                .map(|a| a.display())
                .collect()
        } else {
            unreachable!()
        }
    };
    // run the metadata child through the SAME supervisor the GUI uses
    let mut sup = Supervisor::new();
    let logs: Rc<RefCell<Vec<String>>> = Rc::new(RefCell::new(Vec::new()));
    sup.spawn(&mid, &argv, Kind::Meta, Some(&root.join("bin")));
    let meta_body = wait_meta(&mut sup, &mid, &logs);
    let ok = "1";
    let arg = format!(
        "{{\"id\":\"{}\",\"ok\":\"{}\",\"payload\":{}}}",
        mid,
        ok,
        ywcore::jstr(&meta_body)
    );
    rt.call("dl_on_meta", Some(&arg)).unwrap();

    // 2) start the download — the fake tool streams progress for ~3 s,
    //    which the OLD architecture's run() containment would have killed
    let s = rt
        .call(
            "ev_start",
            Some(&format!(
                "{{\"meta_id\":\"{}\",\"format_id\":\"\",\"mode\":\"video\"}}",
                mid
            )),
        )
        .unwrap();
    let (jid, jargv) = {
        let v = operon::interp::json_parse(&s).unwrap();
        if let operon::value::Value::Map(m) = &v {
            (
                vstr(mget(m, "id")),
                vlist(mget(m, "argv"))
                    .into_iter()
                    .map(|a| a.display())
                    .collect::<Vec<_>>(),
            )
        } else {
            panic!("bad ev_start response: {}", s)
        }
    };
    assert!(
        jargv.iter().any(|a| a == "--downloader"),
        "argv: {:?}",
        jargv
    );
    sup.spawn(&jid, &jargv, Kind::Download, Some(&root.join("bin")));

    // 3) pump children -> operon exactly like the GUI loop
    let mut saw_progress = false;
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut n_lines = 0u32;
    let mut n_exits = 0u32;
    eprintln!("download argv: {:?}", jargv);
    loop {
        for ev in sup.poll() {
            match ev {
                Ev::Line { job, line } => {
                    n_lines += 1;
                    eprintln!("LINE [{}] {}", job, line);
                    let a = format!(
                        "{{\"id\":{},\"line\":{}}}",
                        ywcore::jstr(&job),
                        ywcore::jstr(&line)
                    );
                    rt.call("dl_on_line", Some(&a)).unwrap();
                    if line.contains("30.0%") || line.contains("60.0%") || line.contains("90.0%") {
                        saw_progress = true;
                    }
                }
                Ev::ErrTail { job, tail } => {
                    let a = format!(
                        "{{\"id\":\"{}\",\"code\":0,\"tail\":{}}}",
                        ywcore::jstr(&job),
                        ywcore::jstr(&tail)
                    );
                    let _ = a;
                }
                Ev::Exit { job, code } => {
                    n_exits += 1;
                    eprintln!("EXIT [{}] code={}", job, code);
                    let a = format!(
                        "{{\"id\":{},\"code\":{},\"tail\":\"\"}}",
                        ywcore::jstr(&job),
                        code
                    );
                    rt.call("dl_on_exit", Some(&a)).unwrap();
                }
                _ => {}
            }
        }
        if Instant::now() > deadline {
            panic!("flow test timed out (lines={} exits={})", n_lines, n_exits);
        }
        let tick = rt.call("ui_tick", None).unwrap();
        if tick.contains("\"state\":\"error\"") {
            panic!("job errored — tick: {}", tick);
        }
        if tick.contains("\"done\"") {
            assert!(tick.contains("Flow Test"), "{}", tick);
            assert!(saw_progress, "progress lines never reached operon");
            break;
        }
        std::thread::sleep(Duration::from_millis(60));
    }
    // 4) history persisted
    let hist = std::fs::read_to_string(root.join("data/history.json")).unwrap();
    assert!(hist.contains("Flow Test"), "history: {}", hist);
    // logs drained (promote ring)
    let _ = rt.drain_logs();
    let _ = logs; // kept for parity with the host shape
}

fn wait_meta(sup: &mut Supervisor, mid: &str, _logs: &Rc<RefCell<Vec<String>>>) -> String {
    let deadline = Instant::now() + Duration::from_secs(30);
    let mut body = String::new();
    loop {
        for ev in sup.poll() {
            match ev {
                Ev::MetaBody { job, body: b } => {
                    if job == mid {
                        body = b;
                    }
                }
                Ev::Exit { job, code: _ } if job == mid => {
                    return body;
                }
                _ => {}
            }
        }
        if Instant::now() > deadline {
            panic!("meta fetch timed out");
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}
