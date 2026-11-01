"""ClinMind-AI 打包入口（Tauri sidecar）。

与 ``main.py`` 的差别：
- 只跑 uvicorn，不探测端口、不开浏览器、不打印横幅（由外壳负责）；
- 端口严格取 ``PORT`` 环境变量，绑定失败直接非零退出，让外壳显示错误页；
- 冻结态下 ``sys.stdin`` 是与父进程的管道，父进程一死即 EOF，用看门狗
  立刻退出，避免残留进程占用端口。
"""

from __future__ import annotations

import os
import sys
import threading


def _reconfigure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except Exception:
                pass


def _start_parent_watchdog() -> None:
    """父进程（Tauri 外壳）消失后自杀，防止孤儿进程占端口。"""
    if os.environ.get("CLINMIND_PARENT_WATCH") != "1":
        return
    stdin = getattr(sys, "stdin", None)
    if stdin is None or not hasattr(stdin, "buffer"):
        return

    def loop() -> None:
        try:
            while stdin.buffer.read(1):
                pass
        except Exception:
            pass
        os._exit(0)

    threading.Thread(target=loop, name="parent-watchdog", daemon=True).start()


def main() -> int:
    _reconfigure_stdio()
    _start_parent_watchdog()

    import config
    import uvicorn
    from app.server import app as fastapi_app

    host = os.environ.get("HOST", "127.0.0.1")
    try:
        port = int(os.environ.get("PORT", "8000"))
    except ValueError:
        print(f"PORT 不是合法整数：{os.environ.get('PORT')!r}", flush=True)
        return 2

    print(
        f"[sidecar] ClinMind-AI v2 启动 {host}:{port} · "
        f"模式={'在线模型协同' if config.is_online_llm_active() else '离线规则仿真'} · "
        f"数据目录={config.RUNTIME_DIR}",
        flush=True,
    )

    config_ = uvicorn.Config(
        fastapi_app,
        host=host,
        port=port,
        log_level="info",
        access_log=False,
        lifespan="on",
    )
    server = uvicorn.Server(config_)
    try:
        server.run()
    except SystemExit as exc:  # 端口占用等
        print(f"[sidecar] 启动失败：{exc}", flush=True)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"[sidecar] 运行异常：{exc!r}", flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
