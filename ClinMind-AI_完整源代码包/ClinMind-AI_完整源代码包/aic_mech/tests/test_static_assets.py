import os
import re
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(PROJECT_ROOT, "static")


class TestStaticAssetsConsistency(unittest.TestCase):
    """Verifies static frontend files, HTML tags, script linkages, and DOM ID integrity."""

    def test_static_files_existence(self):
        """Verify all essential static files exist in static/ directory."""
        required_files = [
            os.path.join(STATIC_DIR, "index.html"),
            os.path.join(STATIC_DIR, "css", "custom.css"),
            os.path.join(STATIC_DIR, "js", "app.js"),
            os.path.join(STATIC_DIR, "js", "ecg_canvas.js"),
            os.path.join(STATIC_DIR, "js", "audio_alerts.js"),
            os.path.join(STATIC_DIR, "js", "dag_view.js"),
            os.path.join(STATIC_DIR, "js", "zoom_adapter.js"),
        ]
        for fpath in required_files:
            self.assertTrue(os.path.isfile(fpath), f"Missing static asset: {fpath}")

    def test_html_script_and_css_tags_linkage(self):
        """Verify index.html includes correct link and script references."""
        index_path = os.path.join(STATIC_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()

        # Check CSS and external libraries
        self.assertIn("custom.css", html)
        self.assertIn("tailwindcss", html)
        self.assertIn("echarts", html)

        # Check JS modules
        self.assertIn("audio_alerts.js", html)
        self.assertIn("ecg_canvas.js", html)
        self.assertIn("dag_view.js", html)
        self.assertIn("app.js", html)
        self.assertIn("zoom_adapter.js", html)

    def test_zoom_adapter_structure_integrity(self):
        """Verify the Ctrl+ zoom-adaptation layer is correctly wired to the page shell."""
        index_path = os.path.join(STATIC_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()

        # 1) 必须存在缩放根容器，且作为 body 的直接子元素包裹全部内容
        self.assertIn('id="zoomRoot"', html, "缺少 #zoomRoot 缩放根容器")
        open_tags = html.count("<div id=\"zoomRoot\"")
        close_tags = html.count("</div><!-- /#zoomRoot -->")
        self.assertEqual(open_tags, 1, "#zoomRoot 开标签应恰好出现一次")
        self.assertEqual(close_tags, 1, "#zoomRoot 闭标签应恰好出现一次，且必须闭合")

        # 2) 缩放指示浮层
        self.assertIn('id="zoomIndicator"', html)

        # 3) body 不应再用 h-screen（改由 zoomRoot 承担满屏职责，避免双重滚动）
        body_tag = re.search(r"<body[^>]*>", html)
        self.assertIsNotNone(body_tag)
        self.assertNotIn("h-screen", body_tag.group(0),
                         "body 不应保留 h-screen，满屏职责已移交 #zoomRoot")

        # 4) 适配脚本自身完整性
        zoom_path = os.path.join(STATIC_DIR, "js", "zoom_adapter.js")
        with open(zoom_path, "r", encoding="utf-8") as f:
            code = f.read()

        # 必须读取 visualViewport —— 这是桌面 Ctrl+ 缩放唯一可靠的信号源
        self.assertIn("visualViewport", code)
        # 必须对 #zoomRoot 施加 transform 缩放抵消
        self.assertIn("zoomRoot", code)
        self.assertIn("transform", code)
        self.assertIn("scale(", code)
        # 括号配平（防止语法错误导致整个模块静默失效）
        self.assertEqual(code.count("{") - code.count("}"), 0, "JS 花括号不配平")
        self.assertEqual(code.count("(") - code.count(")"), 0, "JS 圆括号不配平")

    def test_zoom_layer_css_rules_present(self):
        """Verify custom.css contains the zoom-adaptation layer rules."""
        css_path = os.path.join(STATIC_DIR, "css", "custom.css")
        with open(css_path, "r", encoding="utf-8") as f:
            css = f.read()

        self.assertIn("#zoomRoot", css, "缺少 #zoomRoot 缩放定位规则")
        self.assertIn("transform-origin", css, "缺少 transform-origin 设置")
        self.assertIn("#zoomIndicator", css, "缺少缩放指示浮层样式")
        self.assertIn("text-size-adjust", css, "缺少整页字号缩放锁定")

    def test_dom_element_ids_referenced_in_js_exist_in_html(self):
        """Verify every document.getElementById('...') in JS has a corresponding element in HTML."""
        index_path = os.path.join(STATIC_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()

        html_ids = set(re.findall(r'id=["\']([^"\']+)["\']', html))

        js_files = [
            os.path.join(STATIC_DIR, "js", "app.js"),
            os.path.join(STATIC_DIR, "js", "ecg_canvas.js"),
            os.path.join(STATIC_DIR, "js", "audio_alerts.js"),
            os.path.join(STATIC_DIR, "js", "dag_view.js"),
            os.path.join(STATIC_DIR, "js", "zoom_adapter.js"),
        ]

        referenced_ids = set()
        for jspath in js_files:
            with open(jspath, "r", encoding="utf-8") as f:
                code = f.read()
            found = re.findall(r'getElementById\s*\(\s*["\']([^"\']+)["\']\s*\)', code)
            referenced_ids.update(found)

        missing = referenced_ids - html_ids
        self.assertEqual(
            missing,
            set(),
            f"JavaScript referenced DOM IDs that do not exist in index.html: {missing}",
        )

    def test_audio_alerts_synthesizer_config(self):
        """Verify Web Audio API synthesizer constants and fallback safety."""
        audio_path = os.path.join(STATIC_DIR, "js", "audio_alerts.js")
        with open(audio_path, "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("AudioContext", code)
        self.assertIn("900", code)  # High alarm frequency (IEC 60601-1-8 standard)
        self.assertIn("playQRSBeep", code)
        self.assertIn("playCriticalAlarm", code)

    def test_ecg_canvas_waveform_renderer(self):
        """Verify ECG canvas math generator and drawing context."""
        ecg_path = os.path.join(STATIC_DIR, "js", "ecg_canvas.js")
        with open(ecg_path, "r", encoding="utf-8") as f:
            code = f.read()

        self.assertIn("getContext", code)
        self.assertIn("_renderFrame", code)
        self.assertIn("updateVitals", code)
        self.assertIn("sweepSpeed", code)


if __name__ == "__main__":
    unittest.main(verbosity=2)
