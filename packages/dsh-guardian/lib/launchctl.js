/**
 * launchctl 封装层：spawn 执行 + `print` 输出解析 + bootstrap/bootout 错误分类。
 *
 * 设计要点（为什么这样做）：
 * - 状态判据只用 `launchctl print`：`launchctl list` 在 macOS 26 不显示
 *   「已加载未运行」的定时 job，会误判为未加载，架构明确禁止。
 * - uid 一律 `process.getuid()` 动态获取，失败回退 `id -u`，绝不硬编码 501。
 * - exec 可注入：解析与分类全部为纯函数，单测注入假 exec 即可离线覆盖全部分支，
 *   无需在沙箱中执行真实 bootstrap（WorkBuddy 沙箱全域 EIO）。
 * - `state = not running` 是定时 agent 的空闲常态，解析层原样透传，不判异常。
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

/** detail 字段最大长度（共享约定：stderr 截断至 500 字符）。 */
export const DETAIL_MAX_CHARS = 500;

/** 管理的两个 LaunchAgent（顺序即操作顺序），生产默认值。 */
export const DEFAULT_JOBS = [
  {
    label: "com.deepseek.dsh-guardian",
    plist: "~/Library/LaunchAgents/com.deepseek.dsh-guardian.plist",
  },
  {
    label: "com.deepseek.dsh-guardian-diff",
    plist: "~/Library/LaunchAgents/com.deepseek.dsh-guardian-diff.plist",
  },
];

/**
 * @typedef {{ code: number, stdout: string, stderr: string }} CmdResult
 * @typedef {(argv: string[]) => Promise<CmdResult>} ExecFn
 * @typedef {{ label: string, loaded: boolean, state: string | null, runs: number, lastExitCode: number | null, pid: number | null }} JobStatus
 * @typedef {{ ok: boolean, job: JobStatus, stderr: string, code: number }} PrintResult
 */

/**
 * 默认 exec 实现：child_process.spawn，聚合 stdout/stderr，以退出码收尾。
 * @type {ExecFn}
 */
export function spawnExec(argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * 解析当前用户 uid：优先 process.getuid()，失败回退 `id -u`。
 * 两处均失败抛错（由上层映射为 INTERNAL），绝不硬编码 501。
 * @param {ExecFn} exec
 * @returns {Promise<number>}
 */
export async function resolveUid(exec = spawnExec) {
  if (typeof process.getuid === "function") {
    try {
      return process.getuid();
    } catch {
      // 某些运行环境（如受限线程）getuid 可能抛错，落入 id -u 回退。
    }
  }
  const result = await exec(["id", "-u"]);
  const uid = Number.parseInt(result.stdout.trim(), 10);
  if (result.code === 0 && Number.isInteger(uid) && uid >= 0) return uid;
  throw new Error("无法获取当前用户 uid（process.getuid 与 id -u 均失败）");
}

/**
 * 解析 `launchctl print` 标准输出为 JobStatus。
 *
 * 字段匹配使用「恰好一个前导空白字符」：print 输出中嵌套块
 * （resource/jetsam coalition）也有 `state = active` 等同名字段，
 * 顶层字段缩进为一个 tab、嵌套为两个，单空白前缀可精确命中顶层字段。
 *
 * @param {string} stdout print 的标准输出
 * @param {string} [label] job label（仅用于回填，不参与解析）
 * @returns {JobStatus} loaded 表示「输出中能解析出服务记录」
 */
export function parsePrint(stdout, label = "") {
  const text = String(stdout ?? "");
  const field = (name) => {
    const match = text.match(new RegExp("^[ \\t]" + name + " = (.+)$", "m"));
    return match ? match[1].trim() : null;
  };
  const state = field("state");
  const runsText = field("runs");
  const lastExitText = field("last exit code");
  const pidText = field("pid");
  const runs = runsText !== null ? Number.parseInt(runsText, 10) : NaN;
  const lastExitCode = lastExitText !== null ? Number.parseInt(lastExitText, 10) : NaN;
  const pid = pidText !== null ? Number.parseInt(pidText, 10) : NaN;
  return {
    label,
    // 记录存在的判据：顶层 state 字段可解析（header 行 + state 是 print 记录的最小骨架）
    loaded: state !== null,
    state,
    runs: Number.isNaN(runs) ? 0 : runs,
    lastExitCode: Number.isNaN(lastExitCode) ? null : lastExitCode,
    pid: Number.isNaN(pid) ? null : pid,
  };
}

/** 构造「未加载」占位 JobStatus（print 失败时使用）。 */
export function notLoadedJob(label) {
  return { label, loaded: false, state: null, runs: 0, lastExitCode: null, pid: null };
}

/**
 * bootstrap 错误分类。
 *
 * EIO5（Bootstrap failed: 5: Input/output error）的语义是「服务已在域中」：
 * launchd 在「bootstrap 完成」与「记录对 print 可见」之间存在竞态窗口，
 * 重复 bootstrap 会撞出 EIO5。因此将其归为 ALREADY_RUNNING 做竞态容忍，
 * 由操作后的 print 复验兜底。
 *
 * @param {string} stderr
 * @returns {"ALREADY_RUNNING" | "START_FAILED"}
 */
export function classifyBootstrapError(stderr) {
  const text = String(stderr ?? "");
  if (/Bootstrap failed:\s*5\b/.test(text) || /Input\/output error/i.test(text)) {
    return "ALREADY_RUNNING";
  }
  return "START_FAILED";
}

/**
 * bootout 错误分类。
 *
 * "No such process" / "Could not find service" 表示目标在 bootout 到达前
 * 已不在域中（与并发停止/自然退出竞态），归为 NOT_RUNNING 做竞态容忍。
 *
 * @param {string} stderr
 * @returns {"NOT_RUNNING" | "STOP_FAILED"}
 */
export function classifyBootoutError(stderr) {
  const text = String(stderr ?? "");
  if (/No such process/.test(text) || /Could not find service/.test(text)) {
    return "NOT_RUNNING";
  }
  return "STOP_FAILED";
}

/** 截断文本到 detail 上限（默认 500 字符）。 */
export function truncateDetail(text, max = DETAIL_MAX_CHARS) {
  const value = String(text ?? "").trim();
  return value.length > max ? value.slice(0, max) : value;
}

/** 展开 `~/` 前缀为用户主目录。 */
export function expandHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * 加载管理的 job 列表：默认生产双 job；可用环境变量
 * DSH_GUARDIAN_JOBS（JSON 数组 [{label, plist}]）覆盖——仅供 e2e 测试
 * 指向测试 label，生产部署不设置该变量。
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ label: string, plist: string }[]}
 */
export function loadJobs(env = process.env) {
  const raw = env.DSH_GUARDIAN_JOBS;
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("DSH_GUARDIAN_JOBS 必须为非空 JSON 数组 [{label, plist}]");
    }
    return parsed.map((entry, index) => {
      if (!entry || typeof entry.label !== "string" || typeof entry.plist !== "string") {
        throw new Error(`DSH_GUARDIAN_JOBS 第 ${index} 项缺少 label/plist 字符串字段`);
      }
      return { label: entry.label, plist: expandHome(entry.plist) };
    });
  }
  return DEFAULT_JOBS.map((job) => ({ ...job, plist: expandHome(job.plist) }));
}

/**
 * launchctl 执行器：bootstrap / bootout / print 的统一封装。
 * exec 可注入（默认 spawnExec），uid 动态解析并缓存。
 */
export class LaunchctlRunner {
  /**
   * @param {{ exec?: ExecFn, uid?: number }} [options] uid 仅供测试注入；生产留空走 resolveUid。
   */
  constructor({ exec, uid } = {}) {
    /** @type {ExecFn} */
    this.exec = exec ?? spawnExec;
    /** @type {number | null} */
    this.uidValue = Number.isInteger(uid) ? uid : null;
  }

  /** 解析（并缓存）当前 uid。 */
  async uid() {
    if (this.uidValue === null) {
      this.uidValue = await resolveUid(this.exec);
    }
    return this.uidValue;
  }

  /** gui 域目标前缀，如 "gui/502"。 */
  async domain() {
    return `gui/${await this.uid()}`;
  }

  /**
   * 加载一个 LaunchAgent：`launchctl bootstrap gui/<uid> <plist>`。
   * @param {string} plistPath
   * @returns {Promise<CmdResult>}
   */
  async bootstrap(plistPath) {
    return this.exec(["launchctl", "bootstrap", await this.domain(), plistPath]);
  }

  /**
   * 卸载一个 LaunchAgent：`launchctl bootout gui/<uid> <plist>`。
   * （保持与既有手动启停命令一致：bootout 以 plist 路径指定服务。）
   * @param {string} plistPath
   * @returns {Promise<CmdResult>}
   */
  async bootout(plistPath) {
    return this.exec(["launchctl", "bootout", await this.domain(), plistPath]);
  }

  /**
   * 探测一个 job：`launchctl print gui/<uid>/<label>`。
   * loaded = 退出码 0 且输出中能解析出服务记录；
   * 未加载时 print 报错 "Could not find service ... in domain"（非零退出）。
   * @param {string} label
   * @returns {Promise<PrintResult>}
   */
  async print(label) {
    const result = await this.exec(["launchctl", "print", `${await this.domain()}/${label}`]);
    if (result.code !== 0) {
      return { ok: false, job: notLoadedJob(label), stderr: result.stderr, code: result.code };
    }
    const job = parsePrint(result.stdout, label);
    if (!job.loaded) {
      // 退出码 0 但无记录骨架：保守按未加载处理（复验逻辑同样依赖 loaded 判定）
      return { ok: false, job: notLoadedJob(label), stderr: result.stderr, code: result.code };
    }
    return { ok: true, job, stderr: result.stderr, code: result.code };
  }
}
