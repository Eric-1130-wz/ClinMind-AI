/**
 * zoom_adapter.js — 抢救工作台缩放自适应适配层
 *
 * 【问题背景】
 *   ClinMind-AI 抢救工作台采用「h-screen 满屏 + w-80 固定侧栏 + overflow-hidden」
 *   的大屏布局。用户在浏览器按 Ctrl+Plus 放大后，浏览器的 CSS 视口会等比缩小
 *   （例如 visualViewport.width 从 1920 降到 1280），于是：
 *     1. 固定宽度的左侧决策台占比过大，把右侧生命体征监护栏挤出可视区；
 *     2. body 出现横向滚动条，抢救大屏四周出现白边；
 *     3. ECharts 画布尺寸与容器不匹配，六维雷达与因果拓扑图被裁切变形。
 *
 * 【解决方案】
 *   监听 visualViewport 的 resize 事件，读取当前缩放比例 k，对 #zoomRoot 施加
 *   transform: scale(1/k) 并按 k 反向补偿容器宽高。两者相乘后，界面在用户的
 *   视觉层中恰好还原为设计尺寸 —— 无论按多少次 Ctrl+，内容都完整可见、不变形、
 *   不出滚动条。效果等同于「把浏览器缩放抵消掉」，让抢救大屏始终完整呈现。
 *
 * 【缩放比例的准确读法】（经 Chromium 实测校准）
 *   桌面端 Ctrl+Plus 时：
 *     - window.innerWidth      保持不变（仍是布局视口宽度）
 *     - visualViewport.width   随缩放等比缩小  ← 最可靠的信号
 *     - visualViewport.scale   准确返回缩放倍数（1.25 / 1.5 ...）
 *   因此优先取 visualViewport.scale；若该值为 1（未缩放或不支持），
 *   再退化为 用「设计宽度 / visualViewport.width」估算。
 *
 * 【兼容性】
 *   现代浏览器走 visualViewport 分支；老旧浏览器自动退化为 innerWidth 估算分支。
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // 配置
  // ---------------------------------------------------------------------
  const DESIGN_WIDTH  = 1920;  // 工作台设计基准宽度
  const DESIGN_HEIGHT = 1080;  // 工作台设计基准高度
  const MIN_SCALE     = 0.5;   // 允许的最小缩放（低于此值内容过小不可读）
  const MAX_SCALE     = 3.0;   // 允许的最大缩放
  const TOLERANCE     = 0.01;  // 变化阈值，避免浮点抖动触发无谓重排
  const DEBOUNCE_MS   = 60;    // resize 防抖间隔

  // ---------------------------------------------------------------------
  // 内部状态
  // ---------------------------------------------------------------------
  let root        = null;   // #zoomRoot 元素
  let indicator   = null;   // 右下角缩放指示浮层
  let indBar      = null;   // 浮层内的进度条
  let indPct      = null;   // 浮层内的百分比文本
  let hideTimer   = null;   // 浮层自动隐藏定时器
  let debounceTimer = null; // resize 防抖定时器
  let rafId       = null;   // rAF 节流句柄
  let lastScale   = null;   // 上一次施加的缩放比；null 表示尚未应用过（首屏必须执行）

  // ---------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /**
   * 读取当前浏览器缩放倍数。
   * @returns {number} 1.0 表示 100%（未缩放）
   */
  function getZoomLevel() {
    const vv = window.visualViewport;

    // ---- 路径 1（首选）：直接读 visualViewport.scale ----
    // 桌面 Ctrl+Plus / Ctrl+Minus 与移动端捏合缩放都会准确反映在此。
    if (vv && typeof vv.scale === 'number' && Math.abs(vv.scale - 1) > TOLERANCE) {
      return clamp(vv.scale, MIN_SCALE, MAX_SCALE);
    }

    // ---- 路径 2（兜底）：用 visualViewport.width 相对设计宽度估算 ----
    // 某些内核在桌面缩放时 scale 返回 1，但 width 仍会缩小，此时用宽度比推算。
    if (vv && vv.width > 0) {
      const byWidth = DESIGN_WIDTH / vv.width;
      if (byWidth > 1 + TOLERANCE) {
        return clamp(byWidth, MIN_SCALE, MAX_SCALE);
      }
    }

    // ---- 路径 3（老旧浏览器）：用 innerWidth 估算 ----
    // 若窗口本身就被拖窄，innerWidth 会小于设计宽度，同样按放大处理。
    if (window.innerWidth > 0 && window.innerWidth < DESIGN_WIDTH) {
      return clamp(DESIGN_WIDTH / window.innerWidth, MIN_SCALE, MAX_SCALE);
    }

    return 1.0;
  }

  /**
   * 核心：对根容器施加缩放抵消。
   * @param {number} k 浏览器当前缩放倍数（Ctrl+ 后 > 1）
   */
  function apply(k) {
    if (!root) return;

    // 抵消系数：把被浏览器放大的内容重新压回设计尺寸。
    // 例：用户按 Ctrl+ 到 150%（k=1.5），则 scale(1/1.5)=0.667，
    //     同时容器宽高放大到 1.5 倍，两者相乘 = 设计尺寸，视觉上完整且不变形。
    const compensate = 1 / k;

    // 视口在缩放后的「可用布局尺寸」。用 visualViewport.width 更准确，
    // 因为桌面缩放时 innerWidth 并不变化。
    const vv = window.visualViewport;
    const baseW = (vv && vv.width)  || window.innerWidth  || DESIGN_WIDTH;
    const baseH = (vv && vv.height) || window.innerHeight || DESIGN_HEIGHT;

    root.style.transform = 'scale(' + compensate + ')';
    // 布局尺寸需放大 k 倍：scale(1/k) × (布局宽 × k) = 布局宽，
    // 而布局宽取自被缩小的视觉视口 baseW，两者相乘恰好还原设计尺寸，
    // 使内容在视觉层完整铺满且不产生任何滚动条。
    root.style.width  = (baseW * k) + 'px';
    root.style.height = (baseH * k) + 'px';

    // 缩放比变化幅度很小时跳过重排，避免 ECharts 被无谓地反复重绘。
    // 注意：lastScale 初始为 null，首屏时必定执行一次完整应用。
    if (lastScale !== null && Math.abs(compensate - lastScale) < 0.001) return;
    lastScale = compensate;

    notifyResize();
    updateIndicator(compensate, k);
  }

  /**
   * 派发 resize，让 ECharts 等依赖容器尺寸的组件重新计算画布。
   * 用 rAF 确保等 transform 与尺寸写入完成、布局稳定后再触发。
   */
  function notifyResize() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      // dag_view_manager 若提供了显式重排接口，一并调用
      const mgr = window.dagViewManager || window.dagManager;
      if (mgr && typeof mgr.handleResize === 'function') {
        try { mgr.handleResize(); } catch (_) { /* 组件未就绪时忽略 */ }
      }
    });
  }

  /**
   * 更新右下角缩放指示浮层。
   * @param {number} scale 实际施加的抵消系数
   * @param {number} k      浏览器缩放倍数
   */
  function updateIndicator(scale, k) {
    if (!indicator) return;

    // 显示的是「浏览器当前缩放」（用户视角更有意义）
    const pct = Math.round(k * 100);
    if (indPct) indPct.textContent = pct + '%';
    if (indBar) {
      // 把 50%~250% 映射到进度条 0%~100%
      const w = clamp((pct - 50) / 200, 0, 1);
      indBar.style.width = (w * 100).toFixed(1) + '%';
    }

    indicator.classList.add('show');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (indicator) indicator.classList.remove('show');
    }, 1800);
  }

  /** 缩放过程中抑制过渡动画，消除抖动与闪烁 */
  function markZooming() {
    document.body.classList.add('is-zooming');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      document.body.classList.remove('is-zooming');
      hideTimer = setTimeout(() => {
        if (indicator) indicator.classList.remove('show');
      }, 200);
    }, 260);
  }

  // ---------------------------------------------------------------------
  // 事件
  // ---------------------------------------------------------------------
  function scheduleUpdate(delay) {
    markZooming();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => apply(getZoomLevel()), delay || DEBOUNCE_MS);
  }

  function bindEvents() {
    // visualViewport：桌面缩放与移动端捏合都触发这里
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => scheduleUpdate());
      window.visualViewport.addEventListener('scroll', () => scheduleUpdate());
    }

    // window resize：拖拽窗口、开发者工具开合
    window.addEventListener('resize', () => scheduleUpdate(DEBOUNCE_MS));

    // 键盘：Ctrl + Plus / Minus / 0 —— 立即响应，不等防抖
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key;
      const isZoomKey =
        key === '+' || key === '=' || key === 'Add' ||   // Ctrl+Plus
        key === '-' || key === '_' || key === 'Subtract' || // Ctrl+Minus
        key === '0';                                          // Ctrl+0 复位
      if (!isZoomKey) return;

      // 不阻止浏览器默认缩放（用户要的就是缩放），只在其完成后重新计算补偿。
      // 浏览器完成缩放会触发 visualViewport.resize，这里先做一次即时补偿，
      // 再用双 rAF 在缩放落定后精确校正一次。
      e.preventDefault();
      apply(getZoomLevel());
      requestAnimationFrame(() => requestAnimationFrame(() => {
        apply(getZoomLevel());
        scheduleUpdate(30);
      }));
    }, { passive: false });

    // 滚轮 + Ctrl：Windows/Chrome 常用的页面缩放手势
    window.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      markZooming();
      scheduleUpdate(120);
    }, { passive: true });

    // ---- 兜底轮询 ----
    // 某些内核 / 自动化环境在改变页面缩放时并不派发 visualViewport.resize，
    // 导致补偿不生效。这里以 400ms 周期轻量比对缩放比，变化时才重新应用，
    // 代价极低（一次浮点比较），却能保证任何环境下缩放适配都可靠。
    setInterval(() => {
      const k = getZoomLevel();
      const compensate = 1 / k;
      if (lastScale === null || Math.abs(compensate - lastScale) >= 0.001) {
        apply(k);
      }
    }, 400);
  }

  // ---------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------
  function init() {
    root = document.getElementById('zoomRoot');
    if (!root) {
      console.warn('[ZoomAdapter] 未找到 #zoomRoot，缩放适配未启用。');
      return;
    }

    indicator = document.getElementById('zoomIndicator');
    if (indicator) {
      indBar = indicator.querySelector('.bar > i');
      indPct = indicator.querySelector('.pct');
    }

    bindEvents();

    // 首次应用（等 Tailwind CDN 样式与 ECharts 加载完毕）
    const boot = () => setTimeout(() => apply(getZoomLevel()), 150);
    if (document.readyState === 'complete') {
      boot();
    } else {
      window.addEventListener('load', boot);
    }

    // 调试接口：控制台可查当前缩放比，或手动复位
    window.__zoomAdapter = {
      getZoomLevel,
      apply,
      reset: () => apply(1.0),
      info: () => ({ zoom: getZoomLevel(), appliedScale: lastScale }),
    };

    console.log('[ZoomAdapter] 缩放自适应已启用 · 设计基准 %dx%d · 按 Ctrl+0 可复位。',
      DESIGN_WIDTH, DESIGN_HEIGHT);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
