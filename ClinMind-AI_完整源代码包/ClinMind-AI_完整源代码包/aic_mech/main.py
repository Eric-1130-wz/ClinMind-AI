"""ClinMind-AI Main Application Entry Point.

Starts the Uvicorn web server and outputs accessible endpoints.
"""

import sys
import uvicorn
import config


def main():
    """Start ClinMind-AI Web Application."""
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print("=" * 72)
    print("🏥 ClinMind-AI: 临床决策思维推演与OSCE智能评测系统 [竞赛生产级]")
    print("=" * 72)
    print(f"📍 本地服务地址: http://127.0.0.1:{config.PORT}")
    print(f"🌐 急诊抢救大屏: http://127.0.0.1:{config.PORT}/static/index.html")
    print(f"📖 API 交互文档: http://127.0.0.1:{config.PORT}/docs")
    use_online = getattr(config, "USE_ONLINE_LLM", False)
    print(f"⚙️ 运行模式: {'在线LLM协同' if use_online else '高仿真离线规则引擎 (100%全保真免Key)'}")
    print("=" * 72)

    uvicorn.run(
        "app.server:app",
        host=config.HOST,
        port=config.PORT,
        reload=config.DEBUG,
        log_level="info"
    )


if __name__ == "__main__":
    main()
