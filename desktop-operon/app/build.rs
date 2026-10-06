//! build.rs — embed the aria2 bundle.
//!
//! CI sets TF_ARIA2 to the path of the real aria2c.exe (downloaded from the
//! official aria2 release); the binary is copied into OUT_DIR and embedded
//! with include_bytes! by main.rs. Without TF_ARIA2 (local dev builds) a
//! tiny placeholder is embedded instead — the app detects it at runtime,
//! skips extraction and shows "aria2: not bundled (dev build)" instead of
//! shipping a broken downloader.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let dst = out.join("aria2c.exe");
    match env::var("TF_ARIA2") {
        Ok(src) if !src.is_empty() => {
            fs::copy(&src, &dst)
                .unwrap_or_else(|e| panic!("cannot copy aria2 binary '{}': {}", src, e));
            println!("cargo:rustc-env=TF_ARIA2_REAL=1");
        }
        _ => {
            fs::write(&dst, b"YW-ARIA2-PLACEHOLDER-DEV-BUILD").expect("write placeholder");
            println!("cargo:rustc-env=TF_ARIA2_REAL=0");
        }
    }
    println!("cargo:rerun-if-env-changed=TF_ARIA2");
}
