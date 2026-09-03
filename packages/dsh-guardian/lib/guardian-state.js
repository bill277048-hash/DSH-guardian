/**
 * guardian 运行状态聚合：读取 guardian 自身维护的状态文件与日志，
 * 汇总为 StatusResponse 的 guardian 扩展字段。
 *
 * 硬边界：~/.deepseek-harness/guardian/ 目录对插件为只读——本模块只做
 * readFile/readdir，绝不写入；guardian 脚本由 launchd 定时驱动，与插件无关。
 *
 * 容错原则：.fails / backups/ / 日志文件缺失都是常态（如 guardian 尚未
 * 跑过一轮），对应字段容忍为 0 / 0 / []，不向上抛错。
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 日志尾部默认截取行数。 */
export const DEFAULT_TAIL_LINES = 20;

export class StatusAggregator {
  /**
   * @param {{ guardDir?: string, logFile?: string, tailLines?: number }} [options]
   *   路径可注入（单测用临时目录）；生产默认：
   *   guardDir = ~/.deepseek-harness/guardian
   *   logFile  = ~/Library/Logs/deepseek-dsh/guardian.log
   */
  constructor({ guardDir, logFile, tailLines } = {}) {
    this.guardDir = guardDir ?? join(homedir(), ".deepseek-harness", "guardian");
    this.logFile = logFile ?? join(homedir(), "Library", "Logs", "deepseek-dsh", "guardian.log");
    this.tailLines = Number.isInteger(tailLines) && tailLines > 0 ? tailLines : DEFAULT_TAIL_LINES;
  }

  /**
   * 聚合 guardian 扩展状态。
   * @param {object[]} [_jobs] 保留与架构签名一致（当前聚合不依赖 job 明细）
   * @returns {Promise<{ fails: number, backupCount: number, lastLogLines: string[] }>}
   */
  async aggregate(_jobs = []) {
    const [fails, backupCount, lastLogLines] = await Promise.all([
      this.readFails(),
      this.countBackups(),
      this.tailLog(this.tailLines),
    ]);
    return { fails, backupCount, lastLogLines };
  }

  /**
   * 读取连续失败计数 .fails：内容为整数；缺失/不可读/非数字均为 0。
   * @returns {Promise<number>}
   */
  async readFails() {
    try {
      const text = await readFile(join(this.guardDir, ".fails"), "utf8");
      const value = Number.parseInt(text.trim(), 10);
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  /**
   * 统计 backups/ 目录下的备份文件数；目录缺失为 0。
   * @returns {Promise<number>}
   */
  async countBackups() {
    try {
      const entries = await readdir(join(this.guardDir, "backups"), { withFileTypes: true });
      return entries.filter((entry) => entry.isFile()).length;
    } catch {
      return 0;
    }
  }

  /**
   * 读取 guardian.log 尾部 n 个非空行；日志缺失为 []。
   * @param {number} [n]
   * @returns {Promise<string[]>}
   */
  async tailLog(n = DEFAULT_TAIL_LINES) {
    try {
      const text = await readFile(this.logFile, "utf8");
      const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
      return lines.slice(-n);
    } catch {
      return [];
    }
  }
}
