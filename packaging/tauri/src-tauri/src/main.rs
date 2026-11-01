// ClinMind-AI 桌面壳：拉起 Python 后端 sidecar，等 /api/health 200 后用
// WebView2 加载本机 HTTP 页面。刻意不依赖 tauri-plugin-shell —— 自己用
// std::process::Command 管进程，才能加 CREATE_NO_WINDOW 和 stdin 看门狗。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const SIDECAR_NAME: &str = "clinmind-server";
const HEALTH_TIMEOUT: Duration = Duration::from_secs(60);

/// 子进程句柄，退出时统一收尸，避免残留占用端口。
struct Sidecar(Mutex<Option<Child>>);

fn free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8731)
}

/// 裸 HTTP/1.0 GET，只看状态码，避免为一个健康检查引入 reqwest。
fn http_is_200(port: u16) -> bool {
    let Ok(addr) = format!("127.0.0.1:{port}").parse::<SocketAddr>() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1500)));
    let req = "GET /api/health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 128];
    match stream.read(&mut buf) {
        Ok(n) if n > 12 => {
            let head = String::from_utf8_lossy(&buf[..n]);
            head.starts_with("HTTP/1.") && head.contains(" 200")
        }
        _ => false,
    }
}

/// sidecar 的位置随形态变化：安装态在 resources 的 sidecar/ 下，开发态在
/// src-tauri/sidecar/（target/{debug,release} 往上两级）。逐个探测。
fn sidecar_path(install_dir: &PathBuf, resource_dir: &PathBuf) -> Option<PathBuf> {
    let exe = format!("{SIDECAR_NAME}.exe");
    let dev_root = install_dir.join("..").join("..");
    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in [resource_dir.clone(), install_dir.clone(), dev_root] {
        candidates.push(root.join("sidecar").join(&exe));
        candidates.push(root.join("resources").join("sidecar").join(&exe));
        candidates.push(root.join(&exe));
        candidates.push(root.join("binaries").join(format!(
            "{SIDECAR_NAME}-x86_64-pc-windows-gnu.exe"
        )));
        candidates.push(root.join("binaries").join(format!(
            "{SIDECAR_NAME}-x86_64-pc-windows-msvc.exe"
        )));
    }
    candidates.into_iter().find(|p| p.is_file())
}

fn spawn_sidecar(exe: &PathBuf, port: u16, data_dir: &PathBuf) -> std::io::Result<Child> {
    let mut cmd = Command::new(exe);
    cmd.env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("CLINMIND_PARENT_WATCH", "1")
        .env("CLINMIND_RUNTIME_DIR", data_dir.join("runtime"))
        .env("CLINMIND_CONFIG_DIR", data_dir)
        .env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
}

fn piped_tail<R: Read + Send + 'static>(mut r: R, tag: &'static str) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]);
                    for line in s.lines().filter(|l| !l.trim().is_empty()) {
                        println!("[{tag}] {line}");
                    }
                }
            }
        }
    });
}

fn fail(app: &tauri::AppHandle, msg: String) {
    eprintln!("{msg}");
    let html = format!(
        r#"<html><head><meta charset="utf-8"><style>
        body{{margin:0;background:#0b1220;color:#e6edf7;font:14px/1.7 "Microsoft YaHei",sans-serif;
        display:flex;align-items:center;justify-content:center;height:100vh}}
        .box{{max-width:620px;padding:28px 32px;border:1px solid #24405f;border-radius:12px;background:#111c2e}}
        h2{{margin:0 0 12px;font-size:16px;color:#ff8f8f}}
        pre{{white-space:pre-wrap;word-break:break-all;color:#9db2cc;font-size:12px}}</style></head>
        <body><div class="box"><h2>本地服务启动失败</h2><pre>{}</pre></div></body></html>"#,
        msg.replace('<', "&lt;")
    );
    let _ = WebviewWindowBuilder::new(
        app,
        "main",
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("ClinMind-AI · 启动失败")
    .inner_size(760.0, 420.0)
    .initialization_script(&format!(
        "document.open();document.write({});document.close();",
        serde_json::to_string(&html).unwrap_or_else(|_| "\"\"".into())
    ))
    .build();
}

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let install_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(PathBuf::from))
                .unwrap_or_else(|| PathBuf::from("."));
            let port = free_port();

            // 安装目录（Program Files）不可写：SQLite 与 .env 都放用户数据目录。
            let data_dir = app
                .path()
                .app_local_data_dir()
                .unwrap_or_else(|_| install_dir.join("data"));
            let _ = std::fs::create_dir_all(data_dir.join("runtime"));

            let resource_dir = app
                .path()
                .resource_dir()
                .unwrap_or_else(|_| install_dir.clone());

            let Some(exe) = sidecar_path(&install_dir, &resource_dir) else {
                fail(
                    &handle,
                    format!(
                        "未找到后端可执行文件 {SIDECAR_NAME}.exe。\n查找目录：{}",
                        install_dir.display()
                    ),
                );
                return Ok(());
            };
            println!("[shell] sidecar = {}", exe.display());

            let mut child = match spawn_sidecar(&exe, port, &data_dir) {
                Ok(c) => c,
                Err(e) => {
                    fail(&handle, format!("无法启动 {}：{e}", exe.display()));
                    return Ok(());
                }
            };
            if let Some(out) = child.stdout.take() {
                piped_tail(out, "server");
            }
            if let Some(err) = child.stderr.take() {
                piped_tail(err, "server!");
            }
            app.manage(Sidecar(Mutex::new(Some(child))));

            let url = format!("http://127.0.0.1:{port}/static/reception.html");
            let started = Instant::now();
            std::thread::spawn(move || {
                while started.elapsed() < HEALTH_TIMEOUT {
                    if http_is_200(port) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                if !http_is_200(port) {
                    eprintln!("[shell] 后端在 {HEALTH_TIMEOUT:?} 内未就绪");
                    return;
                }
                let window = WebviewWindowBuilder::new(
                    &handle,
                    "main",
                    WebviewUrl::External(url.parse().unwrap()),
                )
                .title("ClinMind-AI · 临床思维教学模拟")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 680.0)
                .center()
                .build();
                if let Err(e) = window {
                    eprintln!("[shell] 窗口创建失败: {e}");
                }
            });

            // 数据目录（SQLite + .env）已随 spawn 的 env 交给 sidecar。
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Tauri 初始化失败");

    app.run(|handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            if let Some(state) = handle.try_state::<Sidecar>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
    });
}
