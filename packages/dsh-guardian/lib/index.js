/**
 * dsh-guardian 插件 host 入口（ESM，cordis 双面插件的 host 半）。
 *
 * 职责：装配 GuardianService（LaunchctlRunner + StatusAggregator + AsyncMutex），
 * 经 makeGuardianRoutes 注册 /api/guardian/* 三条路由，fiber dispose 时反注册。
 *
 * 本插件是既有手动启停命令的纯封装：只调 launchctl bootstrap/bootout/print，
 * 绝不执行 dsh-guardian.sh，绝不写 ~/.deepseek-harness/guardian/（只读），
 * 绝不触碰 com.deepseek.dsh / com.deepseek.dsh-proxy。
 */
import { AsyncMutex } from "./mutex.js";
import {
  LaunchctlRunner,
  classifyBootstrapError,
  classifyBootoutError,
  loadJobs,
  truncateDetail,
} from "./launchctl.js";
import { StatusAggregator } from "./guardian-state.js";
import { makeGuardianRoutes } from "./routes.js";

const PACKAGE_NAME = "@botton/dsh-guardian";

/** 平台门控：launchctl/launchd 仅 macOS 可用；非 darwin 时面板/API 返回提示，不执行 launchctl。 */
const IS_MACOS = process.platform === "darwin";
const UNSUPPORTED_MESSAGE = "守护管理仅支持 macOS（launchd）；当前系统非 macOS，dsh 无 launchd 守护可管，本面板不可用。";

/** bootout 复验等待：launchd 移除记录有毫秒级延迟，避免误报 STOP_VERIFY_FAILED。 */
const BOOTOUT_VERIFY_DELAY_MS = 300;

/** 中文反馈文案（架构 §4 表逐字实现；OK 文案按动作区分）。 */
export const MESSAGES = {
  start: {
    OK: "守护程序已启动（定时巡检与变更侦测均已加载）",
    ALREADY_RUNNING: "守护程序已在运行中，无需重复启动",
    START_FAILED: "守护程序启动失败，请检查 plist 文件与系统日志（详情附后）",
    START_VERIFY_FAILED: "启动指令已执行但服务未正常加载，请在终端运行 launchctl print 检查",
  },
  stop: {
    OK: "守护程序已停止",
    NOT_RUNNING: "守护程序当前未在运行，无需停止",
    STOP_FAILED: "守护程序停止失败（详情附后），请重试或在终端手动执行 bootout",
    STOP_VERIFY_FAILED: "停止指令已执行但服务仍在运行，请重试",
  },
};
export const BUSY_MESSAGE = "正在执行上一个操作，请稍候";
export const PARTIAL_MESSAGE = "状态异常：两个守护任务仅一个在运行，建议先停止再重新启动";

/**
 * 守护程序领域服务：status（无锁）+ start/stop（互斥锁内，
 * 语义严格按「先 print 探测 → 只对需要的 job 动作 → print 复验」）。
 */
export class GuardianService {
  /**
   * @param {{ runner?: LaunchctlRunner, aggregator?: StatusAggregator,
   *   mutex?: AsyncMutex, jobs?: { label: string, plist: string }[],
   *   sleep?: (ms: number) => Promise<void> }} [options] 均可注入（测试友好）。
   */
  constructor({ runner, aggregator, mutex, jobs, sleep } = {}) {
    this.runner = runner ?? new LaunchctlRunner();
    this.aggregator = aggregator ?? new StatusAggregator();
    this.mutex = mutex ?? new AsyncMutex();
    this.jobs = jobs ?? loadJobs();
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** 对全部 job 做 print 探测，返回 JobStatus 数组（顺序与 this.jobs 一致）。 */
  async probeAll() {
    return Promise.all(this.jobs.map(async (job) => (await this.runner.print(job.label)).job));
  }

  /** 构造 ActionResponse：ok 仅当 code === "OK"；detail 可选（stderr 摘要）。 */
  respond(action, code, jobs, detail) {
    const body = {
      ok: code === "OK",
      action,
      code,
      message: MESSAGES[action][code] ?? code,
      jobs,
    };
    if (detail) body.detail = detail;
    return body;
  }

  /** 锁占用时的 409 BUSY 响应（仍附一次探测结果，便于面板刷新展示）。 */
  async busy(action) {
    return {
      ok: false,
      action,
      code: "BUSY",
      message: BUSY_MESSAGE,
      jobs: await this.probeAll(),
    };
  }

  /**
   * 状态查询（不加锁）：双 job print + guardian 状态文件/日志聚合。
   * overall 枚举：active（双 loaded）/ partial（单 loaded，异常）/ stopped（双未加载）。
   * @returns {Promise<object>} StatusResponse
   */
  async status() {
    if (!IS_MACOS) {
      return {
        ok: false,
        overall: "unsupported",
        code: "UNSUPPORTED_PLATFORM",
        message: UNSUPPORTED_MESSAGE,
        jobs: [],
        guardian: { fails: 0, backupCount: 0, lastLogLines: [] },
        checkedAt: new Date().toISOString(),
      };
    }
    const jobs = await this.probeAll();
    const loadedCount = jobs.filter((job) => job.loaded).length;
    const overall =
      loadedCount === 0 ? "stopped" : loadedCount === this.jobs.length ? "active" : "partial";
    const guardian = await this.aggregator.aggregate(jobs);
    const body = {
      ok: true,
      overall,
      jobs,
      guardian,
      checkedAt: new Date().toISOString(),
    };
    if (overall === "partial") body.message = PARTIAL_MESSAGE;
    return body;
  }

  /**
   * 启动（互斥）：先探测双 loaded → ALREADY_RUNNING（不发 bootstrap）；
   * 仅对未加载的 plist bootstrap；EIO5 视为该 job 已加载（竞态容忍）；
   * 其他非零即 START_FAILED；完成后 print 复验双 loaded。
   * @returns {Promise<object>} ActionResponse
   */
  async start() {
    if (!IS_MACOS) {
      return { ok: false, action: "start", code: "UNSUPPORTED_PLATFORM", message: UNSUPPORTED_MESSAGE, jobs: [] };
    }
    const release = await this.mutex.acquire();
    if (!release) return this.busy("start");
    try {
      const before = await this.probeAll();
      if (before.every((job) => job.loaded)) {
        return this.respond("start", "ALREADY_RUNNING", before);
      }
      let raceDetail;
      for (let i = 0; i < this.jobs.length; i++) {
        if (before[i].loaded) continue;
        const result = await this.runner.bootstrap(this.jobs[i].plist);
        if (result.code === 0) continue;
        const code = classifyBootstrapError(result.stderr);
        if (code === "ALREADY_RUNNING") {
          // EIO5 竞态容忍：记录 stderr 供排查，继续处理其余 job，复验兜底
          raceDetail = truncateDetail(result.stderr);
          continue;
        }
        const after = await this.probeAll();
        return this.respond("start", "START_FAILED", after, truncateDetail(result.stderr));
      }
      const after = await this.probeAll();
      if (!after.every((job) => job.loaded)) {
        return this.respond("start", "START_VERIFY_FAILED", after);
      }
      return this.respond("start", "OK", after, raceDetail);
    } finally {
      release();
    }
  }

  /**
   * 停止（互斥，start 的镜像）：先探测双未加载 → NOT_RUNNING（不发 bootout）；
   * 仅对已加载的 job bootout；"No such process"/"Could not find service"
   * 视为该 job 已不在（竞态容忍）；其他非零即 STOP_FAILED；
   * sleep 300ms 后 print 复验，仍可打印则 STOP_VERIFY_FAILED。
   * @returns {Promise<object>} ActionResponse
   */
  async stop() {
    if (!IS_MACOS) {
      return { ok: false, action: "stop", code: "UNSUPPORTED_PLATFORM", message: UNSUPPORTED_MESSAGE, jobs: [] };
    }
    const release = await this.mutex.acquire();
    if (!release) return this.busy("stop");
    try {
      const before = await this.probeAll();
      if (before.every((job) => !job.loaded)) {
        return this.respond("stop", "NOT_RUNNING", before);
      }
      let raceDetail;
      for (let i = 0; i < this.jobs.length; i++) {
        if (!before[i].loaded) continue;
        const result = await this.runner.bootout(this.jobs[i].plist);
        if (result.code === 0) continue;
        const code = classifyBootoutError(result.stderr);
        if (code === "NOT_RUNNING") {
          // 竞态容忍：bootout 到达前 job 已不在域中
          raceDetail = truncateDetail(result.stderr);
          continue;
        }
        const after = await this.probeAll();
        return this.respond("stop", "STOP_FAILED", after, truncateDetail(result.stderr));
      }
      // bootout 幂等窗口：launchd 移除记录有毫秒级延迟，复验前先等 300ms
      await this.sleep(BOOTOUT_VERIFY_DELAY_MS);
      const after = await this.probeAll();
      if (after.some((job) => job.loaded)) {
        return this.respond("stop", "STOP_VERIFY_FAILED", after);
      }
      return this.respond("stop", "OK", after, raceDetail);
    } finally {
      release();
    }
  }
}

/**
 * mountOnce 防重（与 @linxin666 插件家族同款）：插件家族 bundle 会给每个
 * 子行 id 加 web-ui-* 命名空间，loader 允许同一包独立安装并存；若无此守卫，
 * 第二个实例会重复注册同名 webserver 路由导致 boot 失败。registry 挂在全局
 * Symbol 上，保证同一包的两个模块实例（npm 拷贝 vs 仓库链接）共享一个判定。
 * cordis ctx.effect 立即执行回调并把返回值当作 fiber disposer，因此反注册
 * 函数是「返回」而非「执行」。
 */
const MOUNTED = Symbol.for("dsh-web.mounted-plugins");
function mountedSet() {
  const registry = globalThis;
  return (registry[MOUNTED] ??= new Set());
}
function mountOnce(packageName, fn) {
  return (...args) => {
    const mounted = mountedSet();
    if (mounted.has(packageName)) return;
    mounted.add(packageName);
    args[0]?.effect?.(() => () => {
      mounted.delete(packageName);
    });
    return fn(...args);
  };
}

/** cordis 插件名（与 insert 行 id 一致）。 */
export const name = "web-ui-guardian";
/** 依赖 host webserver 服务。 */
export const inject = ["webServer"];

/**
 * 插件 apply：装配服务 → 注册路由 → 返回清理（dispose 时逐条反注册路由）。
 * @param {object} ctx cordis 上下文（注入 webServer）
 * @param {object} [_config] insert 条目可选 config（v1 无配置项）
 */
export const apply = mountOnce(PACKAGE_NAME, (ctx, _config) => {
  const service = new GuardianService();
  const disposers = makeGuardianRoutes(service).map((route) => ctx.webServer.register(route));
  return ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        // 反注册失败不影响其余清理
      }
    }
  });
});
