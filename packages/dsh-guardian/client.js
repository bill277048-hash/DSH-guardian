/**
 * dsh-guardian 插件浏览器半（client）。
 *
 * 手写 ModuleLoader 包装格式（无构建链、无 JSX）：factory(require) 内
 * require("react")，以 React.createElement 渲染。注册到全体样本共用的
 * "web-ui.plugin.item" slot（WebUI 插件管理页卡片列表），面板含状态卡片 +
 * 启动/停止/刷新按钮 + 按 code 着色的中文反馈。
 *
 * client → host 走「host webServer 路由 + 浏览器 fetch」模式（与 doctor /
 * task-board 样本一致），非 cordis 服务 RPC。
 */
window.__ModuleLoader__.load({
  id: "@botton/dsh-guardian",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useCallback = react.useCallback;
    var useRef = react.useRef;

    /** host 路由（loopback-only，同源 fetch 无需鉴权头）。 */
    var API = {
      status: "/api/guardian/status",
      start: "/api/guardian/start",
      stop: "/api/guardian/stop"
    };

    /** 状态轮询间隔（架构 §6：面板挂载后每 5s 轮询 status）。 */
    var POLL_INTERVAL_MS = 5000;

    /**
     * 反馈着色（架构 §4）：OK 绿；ALREADY_RUNNING / NOT_RUNNING 黄（提示
     * 非故障）；BUSY 灰；其余（*_FAILED / INTERNAL）红。
     */
    function feedbackColor(code) {
      if (code === "OK") return "#1a7f37";
      if (code === "ALREADY_RUNNING" || code === "NOT_RUNNING") return "#9a6700";
      if (code === "BUSY" || code === "UNSUPPORTED_PLATFORM") return "#6e7781";
      return "#cf222e";
    }

    /** overall → 徽标文案与颜色（partial 为异常状态，标红）。 */
    function overallMeta(overall) {
      if (overall === "active") return { text: "运行中", color: "#1a7f37", bg: "#dafbe1" };
      if (overall === "partial") return { text: "部分运行（异常）", color: "#cf222e", bg: "#ffebe9" };
      if (overall === "stopped") return { text: "已停止", color: "#6e7781", bg: "#eaeef2" };
      if (overall === "unsupported") return { text: "仅支持 macOS", color: "#6e7781", bg: "#eaeef2" };
      return { text: "查询中…", color: "#6e7781", bg: "#eaeef2" };
    }

    /** 单 job 行内状态描述（"not running" 是定时 agent 常态，不标红）。 */
    function jobStateText(job) {
      if (!job.loaded) return "未加载";
      return job.state || "未知";
    }

    var styles = {
      card: {
        border: "1px solid #d0d7de",
        borderRadius: "8px",
        padding: "16px",
        maxWidth: "560px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif",
        fontSize: "13px",
        color: "#1f2328",
        background: "#ffffff"
      },
      header: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" },
      title: { fontSize: "15px", fontWeight: 600, margin: 0 },
      badge: {
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: "10px",
        fontSize: "12px",
        fontWeight: 600
      },
      section: { marginBottom: "12px" },
      sectionTitle: { fontWeight: 600, marginBottom: "4px", color: "#57606a" },
      jobRow: { display: "flex", gap: "8px", alignItems: "baseline", padding: "2px 0" },
      jobLabel: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" },
      jobMeta: { color: "#57606a", fontSize: "12px" },
      logBox: {
        background: "#f6f8fa",
        border: "1px solid #d0d7de",
        borderRadius: "6px",
        padding: "8px",
        margin: 0,
        maxHeight: "120px",
        overflow: "auto",
        fontSize: "11px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all"
      },
      buttonRow: { display: "flex", gap: "8px", marginBottom: "8px" },
      button: {
        padding: "5px 14px",
        borderRadius: "6px",
        border: "1px solid #d0d7de",
        background: "#f6f8fa",
        cursor: "pointer",
        fontSize: "13px"
      },
      primaryButton: {
        padding: "5px 14px",
        borderRadius: "6px",
        border: "1px solid #1f883d",
        background: "#1f883d",
        color: "#ffffff",
        cursor: "pointer",
        fontSize: "13px"
      },
      dangerButton: {
        padding: "5px 14px",
        borderRadius: "6px",
        border: "1px solid #cf222e",
        background: "#ffffff",
        color: "#cf222e",
        cursor: "pointer",
        fontSize: "13px"
      },
      disabled: { opacity: 0.5, cursor: "not-allowed" },
      feedback: { marginTop: "4px", fontWeight: 600 },
      detail: { color: "#57606a", fontWeight: 400, fontSize: "11px", marginTop: "2px" }
    };

    function disabledStyle(base, disabled) {
      return disabled ? Object.assign({}, base, styles.disabled) : base;
    }

    /** 守护程序面板卡片。 */
    function GuardianPanel() {
      var statusState = useState(null);
      var status = statusState[0];
      var setStatus = statusState[1];
      var loadErrorState = useState(null);
      var loadError = loadErrorState[0];
      var setLoadError = loadErrorState[1];
      var feedbackState = useState(null);
      var feedback = feedbackState[0];
      var setFeedback = feedbackState[1];
      var pendingState = useState(null);
      var pending = pendingState[0];
      var setPending = pendingState[1];
      var mountedRef = useRef(true);

      /** 拉取状态（status 不加锁，失败仅提示不判红）。 */
      var refresh = useCallback(function () {
        return fetch(API.status)
          .then(function (res) { return res.json(); })
          .then(function (body) {
            if (!mountedRef.current) return;
            if (body && body.ok) {
              setStatus(body);
              setLoadError(null);
            } else {
              setLoadError((body && (body.message || body.error)) || "状态查询失败");
            }
          })
          .catch(function (error) {
            if (!mountedRef.current) return;
            setLoadError("无法连接插件服务：" + (error && error.message ? error.message : String(error)));
          });
      }, []);

      // 挂载后立即拉一次 + 每 5s 轮询；卸载时清理定时器（ctx.effect 之外的 React 层清理）
      useEffect(function () {
        mountedRef.current = true;
        refresh();
        var timer = setInterval(refresh, POLL_INTERVAL_MS);
        return function () {
          mountedRef.current = false;
          clearInterval(timer);
        };
      }, [refresh]);

      /** 启动/停止：操作期间禁用全部按钮；完成后按 code 着色反馈并立即再拉一次 status。 */
      var act = useCallback(function (action) {
        setPending(action);
        setFeedback(null);
        return fetch(action === "start" ? API.start : API.stop, {
          method: "POST",
          headers: { "content-type": "application/json" }
        })
          .then(function (res) { return res.json(); })
          .then(function (body) {
            if (!mountedRef.current) return;
            setFeedback({
              code: (body && body.code) || "INTERNAL",
              message: (body && body.message) || "未知结果",
              detail: body && body.detail
            });
          })
          .catch(function (error) {
            if (!mountedRef.current) return;
            setFeedback({
              code: "INTERNAL",
              message: "请求失败：" + (error && error.message ? error.message : String(error))
            });
          })
          .finally(function () {
            if (mountedRef.current) setPending(null);
            refresh();
          });
      }, [refresh]);

      var busy = pending !== null;
      var meta = overallMeta(status && status.overall);
      var guardian = status && status.guardian;
      var children = [];

      // 标题 + 总体徽标
      children.push(
        h("div", { key: "header", style: styles.header },
          h("h3", { style: styles.title }, "守护程序（dsh-guardian）"),
          h("span", {
            style: Object.assign({}, styles.badge, { color: meta.color, background: meta.bg })
          }, meta.text))
      );

      // 状态查询失败提示
      if (loadError) {
        children.push(h("div", { key: "load-error", style: { color: "#cf222e", marginBottom: "8px" } }, loadError));
      }

      // 双 job 明细
      if (status && status.jobs) {
        children.push(
          h("div", { key: "jobs", style: styles.section },
            h("div", { style: styles.sectionTitle }, "守护任务"),
            status.jobs.map(function (job) {
              return h("div", { key: job.label, style: styles.jobRow },
                h("span", { style: styles.jobLabel }, job.label),
                h("span", {
                  style: Object.assign({}, styles.jobMeta, !job.loaded ? { color: "#9a6700" } : {})
                }, jobStateText(job) +
                  " · 运行 " + job.runs + " 次" +
                  (job.lastExitCode !== null ? " · 上次退出码 " + job.lastExitCode : "") +
                  (job.pid !== null ? " · pid " + job.pid : "")));
            }))
        );
      }

      // partial 异常提示（架构 §4 #9）
      if (status && status.overall === "partial" && status.message) {
        children.push(h("div", { key: "partial", style: { color: "#cf222e", marginBottom: "8px" } }, status.message));
      }
      // 非 macOS 平台提示（launchd 守护仅 macOS 可用）
      if (status && status.overall === "unsupported" && status.message) {
        children.push(h("div", { key: "unsupported", style: { color: "#6e7781", marginBottom: "8px" } }, status.message));
      }

      // guardian 扩展状态（.fails / backups / 日志尾部）
      if (guardian) {
        children.push(
          h("div", { key: "extras", style: styles.section },
            h("div", { style: styles.sectionTitle }, "巡检概况"),
            h("div", { style: styles.jobMeta },
              "连续失败 " + guardian.fails + " 次 · 备份 " + guardian.backupCount + " 份" +
              (status.checkedAt ? " · 检查于 " + new Date(status.checkedAt).toLocaleString() : "")),
            guardian.lastLogLines && guardian.lastLogLines.length > 0
              ? h("pre", { style: styles.logBox }, guardian.lastLogLines.join("\n"))
              : null)
        );
      }

      // 操作按钮：启动 / 停止 / 刷新（任一操作进行中全部禁用——架构 §6 client 防抖）
      children.push(
        h("div", { key: "buttons", style: styles.buttonRow },
          h("button", {
            style: disabledStyle(styles.primaryButton, busy),
            disabled: busy,
            onClick: function () { act("start"); }
          }, pending === "start" ? "启动中…" : "启动"),
          h("button", {
            style: disabledStyle(styles.dangerButton, busy),
            disabled: busy,
            onClick: function () { act("stop"); }
          }, pending === "stop" ? "停止中…" : "停止"),
          h("button", {
            style: disabledStyle(styles.button, busy),
            disabled: busy,
            onClick: function () { refresh(); }
          }, "刷新"))
      );

      // 操作反馈（按 code 着色；detail 折叠展示供排查）
      if (feedback) {
        children.push(
          h("div", { key: "feedback", style: Object.assign({}, styles.feedback, { color: feedbackColor(feedback.code) }) },
            feedback.message,
            feedback.detail
              ? h("div", { style: styles.detail }, "详情：" + feedback.detail)
              : null)
        );
      }

      return h("div", { style: styles.card }, children);
    }

    /**
     * 防重挂载标记：client 宿主按包名去重，但独立安装与 bundle 并存时
     * 仍可能双 apply，这里加一道全局标记（与 task-board claim 模式一致）。
     */
    var CLAIM_KEY = "__dsh_guardian_panel_mounted__";
    function claimApply() {
      if (globalThis[CLAIM_KEY]) return false;
      globalThis[CLAIM_KEY] = true;
      return true;
    }
    function releaseApply() {
      globalThis[CLAIM_KEY] = false;
    }

    /** 依赖的 client 服务（fiber inject 等待——runtime 就绪后才 apply）。 */
    var inject = ["slots"];

    /**
     * 挂载面板：注册到 "web-ui.plugin.item" slot（全体样本共用的唯一挂载点，
     * 出现在 WebUI 插件管理页卡片列表）。
     * @param ctx client 根上下文（服务：slots）
     */
    function apply(ctx) {
      if (!claimApply()) return;
      ctx.effect(function () { return releaseApply; }, "guardian: apply claim");
      ctx.slots.inject("web-ui.plugin.item", function () {
        try {
          // label 回调直出卡片标题（doctor safeRegister 同款：
          // 相比 locale 命名空间少一个服务依赖，标题恒定中文）
          var unregister = ctx.slots.register({
            name: "web-ui.plugin.item",
            id: "web-ui-guardian",
            order: 130,
            label: function () { return "守护程序"; }
          }, GuardianPanel);
          return function () { unregister(); };
        } catch {
          return function () {};
        }
      });
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
