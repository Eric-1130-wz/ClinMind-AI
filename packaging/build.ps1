#requires -Version 7.0
<#
.SYNOPSIS
  构建 ClinMind-AI 的 Windows 单文件安装包（Tauri NSIS setup.exe）。

.DESCRIPTION
  流水线三步：
    1) PyInstaller 把 FastAPI 后端冻结成 onedir sidecar（packaging/dist/clinmind-server/）
    2) 拷进 tauri/src-tauri/sidecar/，作为 Tauri bundle 的 resources 一起打包
    3) cargo + tauri build 产出 NSIS 安装包

  为什么是 onedir 而不是 onefile：onefile 272 MB，每次启动要把整包解压到临时目录，
  实测冷启 19.6 s；onedir 只要 1.6 s，而且安装包本来就是文件夹形态，没有收益。

  为什么用 GNU 目标：本机没有 MSVC（无 link.exe / 无 Windows SDK），但有
  rustup 的 stable-x86_64-pc-windows-gnu + Strawberry Perl 自带的 mingw-w64。

.PARAMETER SkipSidecar
  跳过 Python 冻结（已有 packaging/dist/clinmind-server/ 时用）。

.PARAMETER SkipShell
  只冻结 Python，不跑 Tauri 打包。

.EXAMPLE
  pwsh packaging/build.ps1
#>
param(
    [switch]$SkipSidecar,
    [switch]$SkipShell
)

$ErrorActionPreference = 'Stop'

$pkg       = $PSScriptRoot
$repo      = Split-Path -Parent $pkg
$aic       = Join-Path $repo 'aic_mech'
$dist      = Join-Path $pkg 'dist'
$build     = Join-Path $pkg 'build'
$tauriDir  = Join-Path $pkg 'tauri'
$srcTauri  = Join-Path $tauriDir 'src-tauri'
$stage     = Join-Path $srcTauri 'sidecar'

# --- 工具链 ---------------------------------------------------------------
# crates.io 在本机不可达，镜像配置写在 tauri/src-tauri/.cargo/config.toml 里。
$env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
$mingw = 'D:\perl\c\bin'                     # Strawberry Perl 自带的 mingw-w64
if (Test-Path $mingw) { $env:PATH = "$mingw;$env:PATH" }
$env:PYTHONUTF8 = '1'

function Assert-Command($name, $hint) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        throw "缺少 $name。$hint"
    }
}

Assert-Command python     '安装 Python 3.12+ 并加入 PATH。'
Assert-Command npm        '安装 Node.js 18+。'
Assert-Command rustc      '安装 rustup 并 rustup toolchain install stable-x86_64-pc-windows-gnu。'

# --- 1. Python sidecar ----------------------------------------------------
if (-not $SkipSidecar) {
    Write-Host '[1/3] 冻结 Python 后端 (PyInstaller onedir)…' -ForegroundColor Cyan
    # 注意：必须展开成扁平的 ('--exclude-module','torch',...)，
    # 写成 "--exclude-module torch" 会被当成一个整体参数传给 PyInstaller。
    $excludes = @(
        'torch', 'pyarrow', 'scipy', 'onnxruntime', 'pandas', 'matplotlib',
        'PIL', 'numpy', 'lxml', 'cryptography', 'sklearn', 'IPython', 'jupyter',
        'pytest', 'tkinter', 'PyQt5', 'PySide6', 'sqlalchemy', 'dateutil'
    ) | ForEach-Object { @('--exclude-module', $_) }

    Push-Location $aic
    try {
        python -m PyInstaller --noconfirm --onedir --console --name clinmind-server `
            --distpath $dist --workpath $build --specpath $pkg `
            --add-data "$aic\static;static" `
            --add-data "$aic\app\data;app\data" `
            --hidden-import uvicorn.logging `
            --hidden-import uvicorn.loops.auto `
            --hidden-import uvicorn.protocols.http.auto `
            --hidden-import uvicorn.protocols.websockets.auto `
            --hidden-import uvicorn.lifespan.on `
            --hidden-import websockets.legacy.server `
            --collect-submodules app @excludes `
            (Join-Path $pkg 'sidecar_entry.py')
        if ($LASTEXITCODE -ne 0) { throw "PyInstaller 失败，退出码 $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

# --- 2. 部署到 Tauri 资源目录 --------------------------------------------
Write-Host '[2/3] 部署 sidecar 到 src-tauri/sidecar…' -ForegroundColor Cyan
$built = Join-Path $dist 'clinmind-server'
if (-not (Test-Path (Join-Path $built 'clinmind-server.exe'))) {
    throw "找不到 $built\clinmind-server.exe，请先跑第 1 步。"
}
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
Copy-Item $built $stage -Recurse
$sizeMb = [math]::Round(((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "      sidecar 体积 $sizeMb MB"

# --- 3. Tauri 打包 --------------------------------------------------------
if (-not $SkipShell) {
    Write-Host '[3/3] Tauri 打包 (NSIS)…' -ForegroundColor Cyan
    Push-Location $tauriDir
    try {
        if (-not (Test-Path 'node_modules\@tauri-apps\cli')) {
            npm install --registry https://registry.npmmirror.com --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
        }
        npx tauri build --target x86_64-pc-windows-gnu
        if ($LASTEXITCODE -ne 0) { throw "tauri build 失败，退出码 $LASTEXITCODE" }
    } finally {
        Pop-Location
    }

    $out = Join-Path $srcTauri 'target\x86_64-pc-windows-gnu\release\bundle\nsis'
    Write-Host ''
    Get-ChildItem $out -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ("安装包: {0}  ({1} MB)" -f $_.FullName, [math]::Round($_.Length / 1MB, 1)) -ForegroundColor Green
    }
}
