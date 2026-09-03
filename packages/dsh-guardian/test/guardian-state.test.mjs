/**
 * StatusAggregator 离线单测（node --test，零依赖）。
 * 临时目录模拟 guardian 状态文件，覆盖：.fails 存在/缺失/非数字、
 * backups 空/非空/缺失、日志缺失/多行尾部截取、aggregate 聚合与容错。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StatusAggregator } from "../package/lib/guardian-state.js";

/** 建一个临时测试环境，返回 { guardDir, logFile, cleanup }。 */
async function makeEnv() {
  const root = await mkdtemp(join(tmpdir(), "dsh-guardian-test-"));
  const guardDir = join(root, "guardian");
  const logFile = join(root, "guardian.log");
  await mkdir(guardDir, { recursive: true });
  return {
    root,
    guardDir,
    logFile,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("readFails：.fails 存在且为数字 → 解析为计数", async () => {
  const env = await makeEnv();
  try {
    await writeFile(join(env.guardDir, ".fails"), "3\n");
    assert.equal(await new StatusAggregator(env).readFails(), 3);
  } finally {
    await env.cleanup();
  }
});

test("readFails：.fails 缺失 → 0（常态容忍）", async () => {
  const env = await makeEnv();
  try {
    assert.equal(await new StatusAggregator(env).readFails(), 0);
  } finally {
    await env.cleanup();
  }
});

test("readFails：.fails 非数字 / 负数 → 0", async () => {
  const env = await makeEnv();
  try {
    const aggregator = new StatusAggregator(env);
    await writeFile(join(env.guardDir, ".fails"), "not-a-number");
    assert.equal(await aggregator.readFails(), 0);
    await writeFile(join(env.guardDir, ".fails"), "-2");
    assert.equal(await aggregator.readFails(), 0);
  } finally {
    await env.cleanup();
  }
});

test("countBackups：backups 目录非空 → 文件数（子目录不计）", async () => {
  const env = await makeEnv();
  try {
    const backups = join(env.guardDir, "backups");
    await mkdir(join(backups, "nested"), { recursive: true });
    await writeFile(join(backups, "a.js.bak"), "a");
    await writeFile(join(backups, "b.js.bak"), "b");
    assert.equal(await new StatusAggregator(env).countBackups(), 2);
  } finally {
    await env.cleanup();
  }
});

test("countBackups：backups 目录缺失 / 为空 → 0", async () => {
  const env = await makeEnv();
  try {
    const aggregator = new StatusAggregator(env);
    assert.equal(await aggregator.countBackups(), 0); // 缺失
    await mkdir(join(env.guardDir, "backups"));
    assert.equal(await aggregator.countBackups(), 0); // 空目录
  } finally {
    await env.cleanup();
  }
});

test("tailLog：多行日志取尾部 n 个非空行", async () => {
  const env = await makeEnv();
  try {
    const lines = Array.from({ length: 10 }, (_, i) => `2026-09-03 07:0${i} [START] line-${i}`);
    await writeFile(env.logFile, lines.join("\n") + "\n\n");
    const aggregator = new StatusAggregator({ ...env, tailLines: 3 });
    assert.deepEqual(await aggregator.tailLog(3), lines.slice(-3));
  } finally {
    await env.cleanup();
  }
});

test("tailLog：日志缺失 → []（常态容忍）", async () => {
  const env = await makeEnv();
  try {
    assert.deepEqual(await new StatusAggregator(env).tailLog(5), []);
  } finally {
    await env.cleanup();
  }
});

test("aggregate：聚合 fails / backupCount / lastLogLines，全部缺失时容忍为零值", async () => {
  const env = await makeEnv();
  try {
    const aggregator = new StatusAggregator({ ...env, tailLines: 2 });
    // 全缺失场景
    assert.deepEqual(await aggregator.aggregate([]), { fails: 0, backupCount: 0, lastLogLines: [] });
    // 完整场景
    await writeFile(join(env.guardDir, ".fails"), "1");
    await mkdir(join(env.guardDir, "backups"));
    await writeFile(join(env.guardDir, "backups", "x.bak"), "x");
    await writeFile(env.logFile, "l1\nl2\nl3\n");
    assert.deepEqual(await aggregator.aggregate([]), {
      fails: 1,
      backupCount: 1,
      lastLogLines: ["l2", "l3"],
    });
  } finally {
    await env.cleanup();
  }
});

test("aggregate：guardDir 整个不存在也不抛错", async () => {
  const aggregator = new StatusAggregator({
    guardDir: join(tmpdir(), "dsh-guardian-test-nonexistent-dir"),
    logFile: join(tmpdir(), "dsh-guardian-test-nonexistent.log"),
  });
  assert.deepEqual(await aggregator.aggregate([]), { fails: 0, backupCount: 0, lastLogLines: [] });
});
