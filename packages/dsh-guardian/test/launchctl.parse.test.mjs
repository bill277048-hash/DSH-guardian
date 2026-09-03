/**
 * launchctl 封装层离线单测（node --test，零依赖）。
 * exec 全部注入假实现——不在任何环境执行真实 launchctl bootstrap/bootout。
 * 覆盖：parsePrint（loaded / not running / running+pid / 嵌套同名字段 /
 * 未加载）、classifyBootstrapError、classifyBootoutError、命令构造、
 * uid 解析与回退、detail 截断。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_JOBS,
  LaunchctlRunner,
  classifyBootstrapError,
  classifyBootoutError,
  expandHome,
  loadJobs,
  notLoadedJob,
  parsePrint,
  resolveUid,
  truncateDetail,
} from "../package/lib/launchctl.js";

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));
const fixture = (name) => readFile(new URL(name, `file://${FIXTURE_DIR}`), "utf8");

const LABEL = "com.deepseek.dsh-guardian";

/** 构造记录 argv 的假 exec。 */
function fakeExec(handler) {
  const calls = [];
  const exec = async (argv) => {
    calls.push(argv);
    return handler(argv);
  };
  exec.calls = calls;
  return exec;
}

test("parsePrint：已加载 + not running（定时 agent 空闲常态）", async () => {
  const job = parsePrint(await fixture("print-loaded-not-running.txt"), LABEL);
  assert.equal(job.label, LABEL);
  assert.equal(job.loaded, true);
  assert.equal(job.state, "not running"); // 原样透传，不判异常
  assert.equal(job.runs, 47);
  assert.equal(job.lastExitCode, 0);
  assert.equal(job.pid, null);
});

test("parsePrint：已加载 + running（含 pid）", async () => {
  const job = parsePrint(await fixture("print-loaded-running.txt"), LABEL);
  assert.equal(job.loaded, true);
  assert.equal(job.state, "running");
  assert.equal(job.runs, 48);
  assert.equal(job.pid, 12345);
});

test("parsePrint：嵌套 coalition 块的同名字段不污染顶层解析", async () => {
  // resource/jetsam coalition 内也有 "state = active"，顶层是 "not running"
  const job = parsePrint(await fixture("print-loaded-not-running.txt"), LABEL);
  assert.equal(job.state, "not running");
});

test("parsePrint：空输出 / 无记录骨架 → loaded:false", () => {
  for (const bad of ["", "garbage\n", "  state = not running"]) {
    // 注意：两个前导空白的 state 是嵌套块样式，不算顶层记录
    assert.equal(parsePrint(bad, LABEL).loaded, false, JSON.stringify(bad));
  }
});

test("print：退出码非 0（Could not find service）→ 未加载", async () => {
  const stderr = await fixture("print-not-loaded-stderr.txt");
  const exec = fakeExec(() => ({ code: 113, stdout: "", stderr }));
  const runner = new LaunchctlRunner({ exec, uid: 501 });
  const result = await runner.print(LABEL);
  assert.equal(result.ok, false);
  assert.equal(result.job.loaded, false);
  assert.deepEqual(result.job, notLoadedJob(LABEL));
  assert.deepEqual(exec.calls[0], ["launchctl", "print", `gui/501/${LABEL}`]);
});

test("print：退出码 0 但无记录骨架 → 保守按未加载", async () => {
  const exec = fakeExec(() => ({ code: 0, stdout: "unexpected\n", stderr: "" }));
  const runner = new LaunchctlRunner({ exec, uid: 501 });
  const result = await runner.print(LABEL);
  assert.equal(result.ok, false);
  assert.equal(result.job.loaded, false);
});

test("bootstrap/bootout 命令构造：gui/<uid> + plist 路径", async () => {
  const exec = fakeExec(() => ({ code: 0, stdout: "", stderr: "" }));
  const runner = new LaunchctlRunner({ exec, uid: 502 });
  await runner.bootstrap("/Users/apple/Library/LaunchAgents/a.plist");
  await runner.bootout("/Users/apple/Library/LaunchAgents/a.plist");
  assert.deepEqual(exec.calls[0], [
    "launchctl", "bootstrap", "gui/502", "/Users/apple/Library/LaunchAgents/a.plist",
  ]);
  assert.deepEqual(exec.calls[1], [
    "launchctl", "bootout", "gui/502", "/Users/apple/Library/LaunchAgents/a.plist",
  ]);
});

test("classifyBootstrapError：EIO5 → ALREADY_RUNNING（竞态容忍）", async () => {
  assert.equal(classifyBootstrapError(await fixture("bootstrap-eio5-stderr.txt")), "ALREADY_RUNNING");
  assert.equal(classifyBootstrapError("Bootstrap failed: 5: Input/output error"), "ALREADY_RUNNING");
});

test("classifyBootstrapError：其他非零 → START_FAILED", async () => {
  assert.equal(classifyBootstrapError(await fixture("bootstrap-generic-error-stderr.txt")), "START_FAILED");
  assert.equal(classifyBootstrapError(""), "START_FAILED");
});

test("classifyBootoutError：No such process / Could not find service → NOT_RUNNING", async () => {
  assert.equal(classifyBootoutError(await fixture("bootout-no-such-process-stderr.txt")), "NOT_RUNNING");
  assert.equal(classifyBootoutError(await fixture("bootout-could-not-find-stderr.txt")), "NOT_RUNNING");
});

test("classifyBootoutError：其他非零 → STOP_FAILED", async () => {
  assert.equal(classifyBootoutError(await fixture("bootout-generic-error-stderr.txt")), "STOP_FAILED");
  assert.equal(classifyBootoutError(""), "STOP_FAILED");
});

test("resolveUid：优先 process.getuid()，不额外执行 id -u", async () => {
  const exec = fakeExec(() => ({ code: 0, stdout: "999\n", stderr: "" }));
  const uid = await resolveUid(exec);
  assert.equal(uid, process.getuid());
  assert.equal(exec.calls.length, 0);
});

test("resolveUid：getuid 不可用时回退 id -u", async () => {
  const original = process.getuid;
  try {
    // 模拟 getuid 抛错的受限环境
    process.getuid = () => { throw new Error("blocked"); };
    const exec = fakeExec(() => ({ code: 0, stdout: "503\n", stderr: "" }));
    assert.equal(await resolveUid(exec), 503);
    assert.deepEqual(exec.calls[0], ["id", "-u"]);
  } finally {
    process.getuid = original;
  }
});

test("resolveUid：两处均失败 → 抛错（由上层映射 INTERNAL）", async () => {
  const original = process.getuid;
  try {
    process.getuid = () => { throw new Error("blocked"); };
    const exec = fakeExec(() => ({ code: 1, stdout: "", stderr: "id: error" }));
    await assert.rejects(() => resolveUid(exec), /uid/);
  } finally {
    process.getuid = original;
  }
});

test("truncateDetail：默认截断至 500 字符", () => {
  const long = "x".repeat(600);
  assert.equal(truncateDetail(long).length, 500);
  assert.equal(truncateDetail(" short \n"), "short"); // trim
  assert.equal(truncateDetail(null), "");
});

test("loadJobs：默认生产双 job，~ 展开为主目录", () => {
  const jobs = loadJobs({});
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].label, DEFAULT_JOBS[0].label);
  assert.equal(jobs[1].label, DEFAULT_JOBS[1].label);
  assert.ok(!jobs[0].plist.startsWith("~"), "plist 应已展开主目录");
  assert.ok(jobs[0].plist.endsWith("Library/LaunchAgents/com.deepseek.dsh-guardian.plist"));
});

test("loadJobs：DSH_GUARDIAN_JOBS 覆盖（e2e 测试 label）", () => {
  const jobs = loadJobs({
    DSH_GUARDIAN_JOBS: JSON.stringify([{ label: "com.deepseek.dsh-guardian-plugin-test", plist: "/tmp/t.plist" }]),
  });
  assert.deepEqual(jobs, [{ label: "com.deepseek.dsh-guardian-plugin-test", plist: "/tmp/t.plist" }]);
});

test("loadJobs：非法 JSON / 非数组 / 缺字段 → 抛错", () => {
  assert.throws(() => loadJobs({ DSH_GUARDIAN_JOBS: "not-json" }));
  assert.throws(() => loadJobs({ DSH_GUARDIAN_JOBS: "[]" }));
  assert.throws(() => loadJobs({ DSH_GUARDIAN_JOBS: JSON.stringify([{ label: "x" }]) }));
});

test("expandHome：~ 与 ~/ 前缀展开，其余原样", () => {
  assert.equal(expandHome("/abs/path"), "/abs/path");
  assert.ok(expandHome("~/x").endsWith("/x"));
  assert.ok(!expandHome("~").includes("~"));
});
