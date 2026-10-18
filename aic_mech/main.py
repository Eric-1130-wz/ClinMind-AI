"""Start the local simulator; optionally open the browser once it is ready."""

import argparse
import os
import socket
import sys
import threading
import time
import webbrowser

import uvicorn
import config


def available_port(host: str, preferred: int) -> int:
    """Do not kill or accidentally open another app already using the port."""
    if not 1 <= preferred <= 65535:
        raise ValueError("PORT 必须是 1–65535 之间的整数")
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    for port in range(preferred, min(preferred + 20, 65536)):
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            try:
                probe.bind((host, port))
            except OSError:
                continue
            return port
    raise RuntimeError(f"端口 {preferred} 起的 20 个端口均不可用，请在 .env 中修改 PORT")


def main():
    parser = argparse.ArgumentParser(description="ClinMind-AI 本地教学模拟系统")
    parser.add_argument("--open-browser", action="store_true", help="服务就绪后自动打开接诊室")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    preferred = config.PORT
    config.PORT = available_port(config.HOST, preferred)
    os.environ["PORT"] = str(config.PORT)
    host = "127.0.0.1" if config.HOST in {"0.0.0.0", "::"} else config.HOST
    host = f"[{host}]" if ":" in host else host
    url = f"http://{host}:{config.PORT}"
    print("=" * 64)
    print("ClinMind-AI v2 · 临床思维教学模拟")
    if config.PORT != preferred:
        print(f"端口 {preferred} 已被占用，本次自动使用 {config.PORT}。")
    print(f"接诊室：{url}")
    print(f"工作站：{url}/static/workstation.html")
    print(f"接口文档：{url}/docs")
    print(f"模式：{'在线模型协同' if config.is_online_llm_active() else '离线规则仿真（免 Key）'}")
    print("请保持窗口开启，按 Ctrl+C 停止。")
    print("=" * 64, flush=True)

    if config.DEBUG:
        # Browser readiness below is for the normal launcher. Reload remains
        # available to developers via DEBUG=true without opening extra tabs.
        uvicorn.run("app.server:app", host=config.HOST, port=config.PORT, reload=True)
        return

    server = uvicorn.Server(uvicorn.Config(
        "app.server:app", host=config.HOST, port=config.PORT, log_level="info"
    ))
    if args.open_browser:
        def open_when_ready():
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and not server.should_exit:
                if server.started:
                    try:
                        webbrowser.open(url)
                    except Exception:
                        print(f"请在浏览器中打开 {url}")
                    return
                time.sleep(0.1)
        threading.Thread(target=open_when_ready, daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
