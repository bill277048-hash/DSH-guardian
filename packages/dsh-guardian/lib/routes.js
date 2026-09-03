/**
 * webServer 路由层：/api/guardian/* 三条路由 + loopback 同源守卫 + JSON 读写辅助。
 *
 * 守卫与 @linxin666/dsh-doctor 同款（socket 回环地址 + Host 回环 + 浏览器
 * 同源标记）：启停接口只允许本机浏览器调用，X-Forwarded-For 永远不可信。
 */
import { truncateDetail } from "./launchctl.js";

/** IPv4 127/8 判定（四段十进制，首段为 127）。 */
function isIPv4Loopback(v4) {
  const parts = v4.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/** socket 远端地址是否为回环（127/8、::1、IPv4-mapped）。 */
function isLoopbackAddress(address) {
  if (address === undefined) return false;
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) return isIPv4Loopback(normalized.slice(7));
  return isIPv4Loopback(normalized);
}

/** URL hostname 是否为回环（localhost / [::1] / 127/8）。 */
function isLoopbackHostname(hostname) {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  return isIPv4Loopback(hostname);
}

/**
 * 请求级信任围栏：回环 socket 地址 AND 回环 Host 头，外加浏览器同源标记。
 * socket 地址为权威依据；X-Forwarded-For 永远不可信。
 * @param {import("node:http").IncomingMessage} req
 * @returns {boolean}
 */
export function isTrustedRequest(req) {
  if (!isLoopbackAddress(req.socket.remoteAddress)) return false;
  const host = req.headers.host;
  if (typeof host !== "string") return false;
  let hostUrl;
  try {
    hostUrl = new URL("http://" + host);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/** 家族默认 JSON 响应头。 */
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
};

/** 写一条 JSON 响应。 */
export function writeJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...JSON_HEADERS, ...headers });
  res.end(payload);
}

/**
 * ActionResponse.code → HTTP 状态码（架构 §4 表）：
 * OK / ALREADY_RUNNING / NOT_RUNNING → 200（后两者 ok:false，属提示非故障）；
 * BUSY → 409；其余（*_FAILED / INTERNAL）→ 500。
 */
export function httpStatusFor(code) {
  switch (code) {
    case "OK":
    case "ALREADY_RUNNING":
    case "NOT_RUNNING":
      return 200;
    case "BUSY":
      return 409;
    default:
      return 500;
  }
}

/** 405 响应（方法不对时）。 */
function writeMethodNotAllowed(res, allow) {
  writeJson(res, 405, { ok: false, error: `method not allowed: use ${allow}` }, { allow });
}

/**
 * 构造 guardian 插件的三条 webServer 路由。
 * @param {{ status(): Promise<object>, start(): Promise<object>, stop(): Promise<object> }} service
 * @returns {{ kind: "exact", path: string, handler: Function }[]}
 */
export function makeGuardianRoutes(service) {
  // 统一围栏：非回环 403；未捕获异常 → 500 INTERNAL（中文文案按架构 §4 #11）
  const guard = (handler) => async (req, res) => {
    if (!isTrustedRequest(req)) {
      writeJson(res, 403, { ok: false, error: "forbidden: loopback-only" });
      return;
    }
    try {
      await handler(req, res);
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      writeJson(res, 500, {
        ok: false,
        code: "INTERNAL",
        message: `插件内部错误：${truncateDetail(summary)}`,
      }, { "cache-control": "no-store" });
    }
  };

  return [
    {
      kind: "exact",
      path: "/api/guardian/status",
      handler: guard(async (req, res) => {
        if (req.method !== "GET") {
          writeMethodNotAllowed(res, "GET");
          return;
        }
        // status 不加锁：随时可查（架构 §3.3）
        const body = await service.status();
        writeJson(res, 200, body, { "cache-control": "no-store" });
      }),
    },
    {
      kind: "exact",
      path: "/api/guardian/start",
      handler: guard(async (req, res) => {
        if (req.method !== "POST") {
          writeMethodNotAllowed(res, "POST");
          return;
        }
        const body = await service.start();
        writeJson(res, httpStatusFor(body.code), body, { "cache-control": "no-store" });
      }),
    },
    {
      kind: "exact",
      path: "/api/guardian/stop",
      handler: guard(async (req, res) => {
        if (req.method !== "POST") {
          writeMethodNotAllowed(res, "POST");
          return;
        }
        const body = await service.stop();
        writeJson(res, httpStatusFor(body.code), body, { "cache-control": "no-store" });
      }),
    },
  ];
}
