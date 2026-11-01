# ClinMind-AI 桌面版打包（Tauri 2）

把 `aic_mech` 的 FastAPI 后端冻结成 sidecar，用一个 Tauri 外壳拉起它、用 WebView2
加载本机页面，最终产出**一个 Windows 安装包**（NSIS `setup.exe`，当前用户安装，
不需要管理员）。

## 产物

| 文件 | 位置 | 说明 |
|---|---|---|
| 安装包 | `packaging/tauri/src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/*.exe` | 单文件 setup，双击安装 |
| sidecar | `packaging/dist/clinmind-server/` | 冻结后的 Python 后端（目录形态） |
| 外壳源码 | `packaging/tauri/` | Rust + tauri.conf.json |

## 一条命令

```powershell
pwsh packaging/build.ps1
```

分步跑：`-SkipSidecar` 复用已有 sidecar，`-SkipShell` 只冻结 Python。

## 结构

```
packaging/
├─ build.ps1                  # 全流程：冻结 → 部署 → tauri build
├─ sidecar_entry.py           # 冻结入口：只跑 uvicorn，不探测端口、不开浏览器
├─ make_icons.py              # 生成 icons/（不依赖 tauri CLI 的图标生成）
├─ dist/clinmind-server/      # PyInstaller 产物（onedir）
└─ tauri/
   ├─ package.json            # @tauri-apps/cli
   ├─ ui/index.html           # 占位页（真正界面由本机 HTTP 服务提供）
   └─ src-tauri/
      ├─ .cargo/config.toml   # crates.io 走 rsproxy 镜像（本机直连超时）
      ├─ tauri.conf.json      # resources: sidecar/**/*，targets: nsis
      ├─ icons/               # make_icons.py 生成
      ├─ sidecar/             # build.ps1 从 dist/ 拷进来，随安装包分发
      └─ src/main.rs          # 起 sidecar → 等 /api/health 200 → 开窗口
```

## 运行期行为

1. 外壳启动先 `TcpListener::bind("127.0.0.1:0")` 拿一个空闲端口；
2. 用 `CREATE_NO_WINDOW` 拉起 `sidecar/clinmind-server.exe`，注入环境变量：

   | 变量 | 值 | 作用 |
   |---|---|---|
   | `PORT` / `HOST` | 刚选的端口 / `127.0.0.1` | 严格绑定，冲突就失败而不是偷偷换端口 |
   | `CLINMIND_RUNTIME_DIR` | `%LOCALAPPDATA%\com.clinmind.ai.desktop\runtime` | SQLite 落盘位置 |
   | `CLINMIND_CONFIG_DIR` | `%LOCALAPPDATA%\com.clinmind.ai.desktop` | `.env`（LLM 配置）落盘位置 |
   | `CLINMIND_PARENT_WATCH` | `1` | 开启 stdin 看门狗 |

3. 每 150 ms 探一次 `/api/health`，拿到 200 就创建窗口加载
   `http://127.0.0.1:<port>/static/reception.html`；60 s 还没起来则显示错误页。
4. 窗口关闭时 `RunEvent::Exit` 里 kill 子进程。子进程另有 stdin 看门狗：外壳被强杀、
   管道断开即 EOF，后端自行退出，不留孤儿进程占端口。

安装目录（`%LOCALAPPDATA%\Programs\ClinMind-AI`）只读放程序，用户数据全部落在
`%LOCALAPPDATA%\com.clinmind.ai.desktop`，所以升级重装不会丢历史数据。

## 环境要求与踩过的坑

本机实测环境：Rust 1.99.0（`stable-x86_64-pc-windows-gnu`）、Node 24.15、
WebView2 Runtime 156、Python 3.12 + PyInstaller 6.21。

1. **crates.io 直连超时**（`index.crates.io` / `static.crates.io` 都连不上）。
   镜像写在 `src-tauri/.cargo/config.toml` 指向 `rsproxy.cn`，只作用于本目录构建，
   不动 `~/.cargo`。
2. **本机没有 MSVC**：没有 `link.exe`、没有 Windows SDK，VS2022 目录是空壳。
   因此必须用 GNU 目标：`RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu` +
   Strawberry Perl 自带的 mingw-w64（`D:\perl\c\bin`，含 gcc/ld/windres）。
   `build.ps1` 会自动设置这两项。**只加 `--target x86_64-pc-windows-gnu` 不够**——
   构建脚本本身仍用 host 工具链编译，会去找 `link.exe` 而失败。
3. **NSIS 工具链**已缓存在 `%LOCALAPPDATA%\tauri\NSIS`（含 `nsis_tauri_utils.dll`
   插件和 WebView2 引导程序），所以 GitHub 504 不影响打包。
4. **必须 onedir 不能 onefile**：onefile 272 MB、冷启 19.6 s（每次都要解压到临时
   目录）；onedir 冷启 1.6 s，且安装包本来就是目录形态。
5. **别让 PyInstaller 把整个 site-packages 拖进来**：不排除的话 `torch` 365 MB、
   `pyarrow` 79 MB、`scipy` 51 MB、`onnxruntime` 35 MB 都会被塞进去，而项目源码
   只用到 `fastapi / httpx / networkx / pydantic / uvicorn / sqlite3`（无 numpy）。
   `build.ps1` 的 `--exclude-module` 列表就是干这个的。
6. PowerShell 传参陷阱：`"--exclude-module torch"` 会被当成一个整体参数，必须展开成
   扁平的 `('--exclude-module','torch',...)`。

## 已知限制

- 只出了 NSIS（`.exe`）目标；MSI 需要 WiX，未启用。
- GNU 工具链构建的 exe 依赖系统 WebView2 Runtime（Win11 自带，Win10 需装）；
  NSIS 安装器内置了 WebView2 引导程序，缺失时会自动安装。
- sidecar 用 `--console` 构建，控制台窗口由外壳用 `CREATE_NO_WINDOW` 屏蔽；
  直接双击 sidecar 会看到控制台，便于排查。
