/**
 * QA 独立验证：12 分支错误分类法实测（注入假 exec，不碰真实 launchctl）。
 * 状态机假 exec：loaded 集合模拟 launchd 域；bootstrap 把 label 加入集合，
 * bootout 移除；print 按集合返回 fixture 风格输出。
 */
import assert from "node:assert/strict";
import { GuardianService } from "/Users/apple/WorkBuddy/2026-09-02-21-05-27/dsh-guardian-plugin/package/lib/index.js";
import { makeGuardianRoutes } from "/Users/apple/WorkBuddy/2026-09-02-21-05-27/dsh-guardian-plugin/package/lib/routes.js";

const JOBS = [
  { label: "com.deepseek.dsh-guardian", plist: "/tmp/qa-a.plist" },
  { label: "com.deepseek.dsh-guardian-diff", plist: "/tmp/qa-b.plist" },
];
const PRINT_LOADED = (label) =>
  `gui/501/${label} = {\n\ttype = LaunchAgent\n\tstate = not running\n\n\truns = 10\n\tlast exit code = 0\n\n\tresource coalition = {\n\t\tstate = active\n\t}\n}\n`;

/** 状态机假 exec：可编程失败注入。 */
function makeWorld({ bootstrapResults = {}, bootoutResults = {} } = {}) {
  const loaded = new Set();
  const calls = [];
  const plistToLabel = new Map(JOBS.map((j) => [j.plist, j.label]));
  const exec = async (argv) => {
    calls.push(argv);
    const [, cmd, domain, pathOrTarget] = argv;
    const target = cmd === "print" ? domain : pathOrTarget;
    if (cmd === "bootstrap") {
      const label = plistToLabel.get(pathOrTarget);
      const injected = bootstrapResults[label];
      if (injected) {
        // EIO5 语义=「服务已在域中」：竞态下另一 actor 已加载，复验时可见
        if (/Input\/output error/.test(injected.stderr)) loaded.add(label);
        return injected;
      }
      loaded.add(label);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "bootout") {
      const label = plistToLabel.get(pathOrTarget);
      const injected = bootoutResults[label];
      if (injected) return injected;
      loaded.delete(label);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (cmd === "print") {
      const label = target.split("/").pop();
      if (loaded.has(label)) return { code: 0, stdout: PRINT_LOADED(label), stderr: "" };
      return { code: 113, stdout: "", stderr: `Could not find service "${label}" in domain for uid: 501` };
    }
    throw new Error("unexpected argv: " + argv.join(" "));
  };
  return { loaded, calls, exec };
}

const noopAggregator = { aggregate: async () => ({ fails: 0, backupCount: 0, lastLogLines: [] }) };
const noSleep = async () => {};
// 直接用 LaunchctlRunner 注入假 exec
import { LaunchctlRunner } from "/Users/apple/WorkBuddy/2026-09-02-21-05-27/dsh-guardian-plugin/package/lib/launchctl.js";
function serviceFor(world) {
  return new GuardianService({
    runner: new LaunchctlRunner({ exec: world.exec, uid: 501 }),
    aggregator: noopAggregator,
    jobs: JOBS,
    sleep: noSleep,
  });
}

let passed = 0;
function check(name, cond, extra = "") {
  assert.ok(cond, `${name} ${extra}`);
  passed++;
  console.log(`PASS  ${name}`);
}

// ── 分支 1+2：start OK（含 bootstrap 调用次数核对）→ 重复 start ALREADY_RUNNING ──
{
  const world = makeWorld();
  const svc = serviceFor(world);
  const r1 = await svc.start();
  check("#1 start→OK", r1.ok === true && r1.code === "OK", JSON.stringify(r1));
  const bootstraps = world.calls.filter((c) => c[1] === "bootstrap");
  check("#1 双 plist 各 bootstrap 一次", bootstraps.length === 2);
  check("#1 message 为启动成功文案", r1.message.includes("已启动"));
  const r2 = await svc.start();
  check("#2 重复 start→ALREADY_RUNNING", r2.ok === false && r2.code === "ALREADY_RUNNING");
  check("#2 未再发 bootstrap", world.calls.filter((c) => c[1] === "bootstrap").length === 2);
}

// ── 分支 6+5：stop 未运行→NOT_RUNNING；运行中 stop→OK；再 stop→NOT_RUNNING ──
{
  const world = makeWorld();
  const svc = serviceFor(world);
  const r0 = await svc.stop();
  check("#6 stop 未运行→NOT_RUNNING", r0.ok === false && r0.code === "NOT_RUNNING");
  check("#6 未发 bootout", world.calls.filter((c) => c[1] === "bootout").length === 0);
  await svc.start();
  const r1 = await svc.stop();
  check("#5 stop→OK", r1.ok === true && r1.code === "OK", JSON.stringify(r1));
  check("#5 双 plist 各 bootout 一次", world.calls.filter((c) => c[1] === "bootout").length === 2);
  const r2 = await svc.stop();
  check("#6b 再 stop→NOT_RUNNING", r2.code === "NOT_RUNNING");
}

// ── 分支 3：bootstrap 非 EIO5 失败 → START_FAILED（500 档）──
{
  const world = makeWorld({
    bootstrapResults: {
      "com.deepseek.dsh-guardian": { code: 1, stdout: "", stderr: "Bootstrap failed: 109: plists are in trash" },
    },
  });
  const svc = serviceFor(world);
  const r = await svc.start();
  check("#3 START_FAILED", r.ok === false && r.code === "START_FAILED", JSON.stringify(r));
  check("#3 detail 含 stderr 摘要", typeof r.detail === "string" && r.detail.includes("109"));
}

// ── 分支 3b：EIO5 竞态容忍 → 复验通过仍 OK，detail 记录 ──
{
  const world = makeWorld({
    bootstrapResults: {
      "com.deepseek.dsh-guardian-diff": { code: 1, stdout: "", stderr: "Bootstrap failed: 5: Input/output error" },
    },
  });
  const svc = serviceFor(world);
  const r = await svc.start();
  check("#2b EIO5 竞态容忍→OK", r.ok === true && r.code === "OK", JSON.stringify(r));
  check("#2b detail 记录 EIO5 原文", typeof r.detail === "string" && r.detail.includes("Input/output error"));
}

// ── 分支 4：bootstrap exit 0 但复验未 loaded → START_VERIFY_FAILED ──
{
  const world = makeWorld();
  // 破坏 bootstrap：exit 0 但不真正加载
  const origExec = world.exec;
  world.exec = async (argv) => {
    if (argv[1] === "bootstrap") return { code: 0, stdout: "", stderr: "" };
    return origExec(argv);
  };
  const svc = serviceFor(world);
  const r = await svc.start();
  check("#4 START_VERIFY_FAILED", r.ok === false && r.code === "START_VERIFY_FAILED", JSON.stringify(r));
}

// ── 分支 7：bootout 其他非零 → STOP_FAILED ──
{
  const world = makeWorld({
    bootoutResults: {
      "com.deepseek.dsh-guardian": { code: 1, stdout: "", stderr: "Boot-out failed: 36: Operation now in progress" },
    },
  });
  const svc = serviceFor(world);
  await svc.start();
  const r = await svc.stop();
  check("#7 STOP_FAILED", r.ok === false && r.code === "STOP_FAILED", JSON.stringify(r));
  check("#7 detail 含 stderr", typeof r.detail === "string" && r.detail.includes("36"));
}

// ── 分支 8：bootout exit 0 但复验仍可打印 → STOP_VERIFY_FAILED ──
{
  const world = makeWorld();
  const origExec = world.exec;
  world.exec = async (argv) => {
    if (argv[1] === "bootout") return { code: 0, stdout: "", stderr: "" }; // 假成功
    return origExec(argv);
  };
  const svc = serviceFor(world);
  await svc.start();
  const r = await svc.stop();
  check("#8 STOP_VERIFY_FAILED", r.ok === false && r.code === "STOP_VERIFY_FAILED", JSON.stringify(r));
}

// ── 分支 7b：bootout 报 No such process → 竞态容忍，复验过则 OK ──
{
  const world = makeWorld({
    bootoutResults: {
      "com.deepseek.dsh-guardian-diff": { code: 3, stdout: "", stderr: "No such process" },
    },
  });
  const svc = serviceFor(world);
  await svc.start();
  world.loaded.delete("com.deepseek.dsh-guardian-diff"); // 模拟已不在域中
  const r = await svc.stop();
  check("#6c No such process 竞态容忍→OK", r.ok === true && r.code === "OK", JSON.stringify(r));
}

// ── 分支 9：partial 状态（单 job loaded）──
{
  const world = makeWorld();
  world.loaded.add("com.deepseek.dsh-guardian"); // 只加载一个
  const svc = serviceFor(world);
  const s = await svc.status();
  check("#9 overall=partial", s.ok === true && s.overall === "partial", JSON.stringify(s.overall));
  check("#9 partial 中文提示", typeof s.message === "string" && s.message.includes("仅一个在运行"));
  const s2 = await svc.status.call(svc); // stopped 态
  world.loaded.delete("com.deepseek.dsh-guardian");
  const s3 = await svc.status();
  check("#9b 双未加载 overall=stopped", s3.overall === "stopped");
  world.loaded.add("com.deepseek.dsh-guardian");
  world.loaded.add("com.deepseek.dsh-guardian-diff");
  const s4 = await svc.status();
  check("#9c 双加载 overall=active", s4.overall === "active" && s4.message === undefined);
}

// ── 分支 10：并发操作 → 409 BUSY ──
{
  const world = makeWorld();
  const svc = serviceFor(world);
  const release = await svc.mutex.acquire(); // 外部持锁模拟进行中的操作
  const r = await svc.start();
  check("#10 锁占用→BUSY", r.ok === false && r.code === "BUSY");
  check("#10 BUSY 中文文案", r.message.includes("请稍候"));
  check("#10 锁占用时未发 bootstrap", world.calls.filter((c) => c[1] === "bootstrap").length === 0);
  release();
  // 真实并发：慢 bootstrap 期间第二个 start
  let releaseGate;
  const gatePromise = new Promise((res) => { releaseGate = res; });
  const slowWorld = makeWorld();
  const origExec = slowWorld.exec;
  slowWorld.exec = async (argv) => {
    if (argv[1] === "bootstrap") await gatePromise;
    return origExec(argv);
  };
  const svc2 = serviceFor(slowWorld);
  const p1 = svc2.start();
  await new Promise((r2) => setImmediate(r2));
  const r2 = await svc2.stop();
  check("#10b 真实并发→BUSY", r2.code === "BUSY");
  releaseGate();
  const r1 = await p1;
  check("#10b 持锁操作正常完成", r1.code === "OK");
}

// ── 分支 11+12：路由层 INTERNAL 与 403；外加 httpStatusFor 映射核对 ──
{
  const routes = makeGuardianRoutes({
    status: async () => { throw new Error("boom-spawn"); },
    start: async () => ({ ok: false, code: "BUSY", message: "x" }),
    stop: async () => ({ ok: true, code: "OK", message: "y" }),
  });
  const mkReq = (method, remote = "127.0.0.1", host = "127.0.0.1:8080") => ({
    method, socket: { remoteAddress: remote }, headers: { host },
  });
  const mkRes = () => {
    const out = {};
    return {
      writeHead(status, headers) { out.status = status; out.headers = headers; },
      end(payload) { out.body = JSON.parse(payload); },
      out,
    };
  };
  const find = (p) => routes.find((r) => r.path === p).handler;

  // 403：非回环 socket
  {
    const res = mkRes();
    await find("/api/guardian/status")(mkReq("GET", "192.168.1.50", "192.168.1.50:8080"), res);
    check("#12 非回环 socket→403", res.out.status === 403 && res.out.body.ok === false);
  }
  // 403：回环 socket 但 Host 非回环（DNS rebinding 防护）
  {
    const res = mkRes();
    await find("/api/guardian/status")(mkReq("GET", "127.0.0.1", "evil.example.com"), res);
    check("#12b Host 非回环→403", res.out.status === 403);
  }
  // 403：cross-site 标记
  {
    const res = mkRes();
    const req = mkReq("GET");
    req.headers["sec-fetch-site"] = "cross-site";
    await find("/api/guardian/status")(req, res);
    check("#12c cross-site→403", res.out.status === 403);
  }
  // 放行：::1 + 回环 Host
  {
    const res = mkRes();
    await find("/api/guardian/status")(mkReq("GET", "::1", "localhost:8080"), res);
    check("#12d ::1+localhost 放行（走到 500 说明过了守卫）", res.out.status === 500);
  }
  // INTERNAL：service 抛异常 → 500 + code INTERNAL + 中文前缀
  {
    const res = mkRes();
    await find("/api/guardian/status")(mkReq("GET"), res);
    check("#11 INTERNAL 500", res.out.status === 500 && res.out.body.code === "INTERNAL");
    check("#11 中文文案", res.out.body.message.startsWith("插件内部错误：") && res.out.body.message.includes("boom-spawn"));
  }
  // httpStatusFor：BUSY→409，OK→200
  {
    const res = mkRes();
    await find("/api/guardian/start")(mkReq("POST"), res);
    check("#10c BUSY→HTTP 409", res.out.status === 409);
    const res2 = mkRes();
    await find("/api/guardian/stop")(mkReq("POST"), res2);
    check("#5b OK→HTTP 200", res2.out.status === 200);
  }
  // 405：方法不对
  {
    const res = mkRes();
    await find("/api/guardian/start")(mkReq("GET"), res);
    check("#extra GET start→405", res.out.status === 405);
  }
}

console.log(`\n=== 全部 ${passed} 项分支断言通过 ===`);
