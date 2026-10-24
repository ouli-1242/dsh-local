// 单元测试：JSON 输出边界、状态修订号、工具审批门。
// 不启动宿主，不碰真实安装。
//
// usage: node test/core.mjs [pluginDir]
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.argv[2] || path.resolve(here, "..");
const load = (name) => import(pathToFileURL(path.join(pluginDir, "lib", name)).href);

const jsonSafe = await load("json-safe.js");
const revision = await load("revision.js");
const gateModule = await load("tool-gate.js");
const platformConfig = await load("redteam/platform-config.js");
const redteamUi = await load("redteam/ui.js");

let pass = 0;
let fail = 0;
function check(label, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? "  <- " + detail : ""}`);
  }
}
function throws(label, fn) {
  try {
    fn();
    check(label, false, "expected a throw");
  } catch {
    check(label, true);
  }
}

console.log("\n== json-safe ==");
{
  const { projectJson, safeProject, stringifySafe } = jsonSafe;

  check("plain round-trip", JSON.stringify(projectJson({ a: 1, b: "x", c: true, d: null })) === '{"a":1,"b":"x","c":true,"d":null}');
  check("undefined field omitted", !("a" in projectJson({ a: undefined, b: 1 })));
  check("null preserved", projectJson({ a: null }).a === null);
  check("nested arrays ok", JSON.stringify(projectJson({ a: [1, [2, 3]] })) === '{"a":[1,[2,3]]}');

  throws("-0 rejected", () => projectJson({ a: -0 }));
  throws("NaN rejected", () => projectJson({ a: NaN }));
  throws("Infinity rejected", () => projectJson({ a: Infinity }));
  throws("BigInt rejected", () => projectJson({ a: 1n }));
  throws("function rejected", () => projectJson({ a: () => 1 }));
  throws("symbol rejected", () => projectJson({ a: Symbol("s") }));

  const circular = { a: 1 };
  circular.self = circular;
  throws("circular rejected", () => projectJson(circular));

  const sparse = [1, , 3];
  throws("sparse array rejected", () => projectJson({ a: sparse }));

  const decorated = [1, 2];
  decorated.extra = "x";
  throws("decorated array rejected", () => projectJson({ a: decorated }));

  const withAccessor = {};
  Object.defineProperty(withAccessor, "a", { enumerable: true, get: () => 1 });
  throws("accessor rejected", () => projectJson(withAccessor));

  class Custom { constructor() { this.a = 1; } }
  throws("class instance rejected", () => projectJson({ a: new Custom() }));

  const deep = {};
  let cursor = deep;
  for (let i = 0; i < 80; i += 1) { cursor.next = {}; cursor = cursor.next; }
  throws("depth cap enforced", () => projectJson(deep));

  const bad = safeProject({ a: 1n });
  check("safeProject never throws", bad.ok === false && bad.value.__invalid === true);
  check("safeProject keeps reason", String(bad.value.__reason).length > 0);
  check("stringifySafe on bad value returns JSON", (() => {
    const text = stringifySafe({ a: 1n });
    return typeof text === "string" && JSON.parse(text).__invalid === true;
  })());

  const big = "0x7FF6A1B2C3D4E5F6";
  check("64-bit address survives as string", projectJson({ ea: big }).ea === big);
}

console.log("\n== revision ==");
{
  const { currentRev, bumpRev, checkRev, lastActionInfo, resetRevForTests } = revision;
  resetRevForTests();
  check("starts at 0", currentRev() === 0);

  const first = checkRev(undefined);
  check("omitted rev passes", first.ok === true && first.rev === 0);
  check("garbage rev passes leniently", checkRev("abc").ok === true);

  bumpRev("apply");
  check("bump increments", currentRev() === 1);
  check("last action recorded", lastActionInfo().action === "apply");

  check("matching rev passes", checkRev(1).ok === true);
  const stale = checkRev(0);
  check("stale rev rejected", stale.ok === false && stale.stale === true);
  check("stale rev carries current", stale.rev === 1 && stale.last.action === "apply");

  const ahead = checkRev(99);
  check("future rev rejected but not stale", ahead.ok === false && ahead.stale === false);

  bumpRev("revert");
  check("second bump", currentRev() === 2 && lastActionInfo().action === "revert");
  resetRevForTests();
  check("reset for tests", currentRev() === 0);
}

console.log("\n== env adapt skip ==");
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-env-"));
  const store = { root };
  const before = redteamUi.handlePlatformOp(store, { op: "platformEnvAdaptStatus" });
  check("fresh env is not skipped", before.ok === true && before.skipped === false);
  const after = redteamUi.handlePlatformOp(store, { op: "platformEnvAdaptSkip", skip: true });
  check("skip makes env ready", after.ok === true && after.ready === true && after.reason === "skipped");
  const reread = platformConfig.envAdaptStatus(root);
  check("skip persists across reads", reread.skipped === true && reread.ready === true);
  redteamUi.handlePlatformOp(store, { op: "platformEnvAdaptSkip", skip: false });
  check("skip can be cleared", platformConfig.envAdaptStatus(root).skipped === false);
  check("unknown op falls through", redteamUi.handlePlatformOp(store, { op: "not-a-platform-op" }) === undefined);
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("\n== tool-gate ==");
{
  const { installToolGate, decisionFromOutcome } = gateModule;
  const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-audit-"));
  const auditFile = path.join(auditDir, "audit.jsonl");

  function makeCtx(outcome, opts = {}) {
    const { withService = true, throwOnRequest = false } = opts;
    const handlers = { "tools/pre-execute": [], "tools/post-execute": [] };
    let requests = 0;
    return {
      handlers,
      requests: () => requests,
      ctx: {
        get(name) {
          if (name !== "approval") return undefined;
          if (!withService) return undefined;
          return {
            async request() {
              requests += 1;
              if (throwOnRequest) throw new Error("approval backend down");
              return outcome;
            },
          };
        },
        on(event, handler) {
          handlers[event].push(handler);
          return () => {
            const at = handlers[event].indexOf(handler);
            if (at >= 0) handlers[event].splice(at, 1);
          };
        },
      },
    };
  }

  const readAudit = () => (fs.existsSync(auditFile)
    ? fs.readFileSync(auditFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : []);
  const runPre = (harness, exec) => harness.handlers["tools/pre-execute"][0](exec, async () => "next");

  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("rejected", { withService: false });
    const gate = installToolGate(h.ctx, { auditPath: () => auditFile, fs, path });
    check("default mode is audit", gate.mode === "audit");
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: false } });
    check("audit mode passes through", out === "next");
    check("audit mode never asks approval", h.requests() === 0);
    check("audit mode records intent", readAudit().some((r) => r.phase === "intent" && r.tool === "purge_apply"));
    gate.dispose();
  }

  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    let nextCalled = false;
    const out = await h.handlers["tools/pre-execute"][0](
      { name: "purge_apply", agent: {}, signal: { aborted: false } },
      async () => { nextCalled = true; return "next"; },
    );
    check("enforce + allowed-once calls next", nextCalled && out === "next");
    check("allow audited", readAudit().some((r) => r.decision === "allow" && r.tool === "purge_apply"));
  }

  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("rejected");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    let nextCalled = false;
    const out = await h.handlers["tools/pre-execute"][0](
      { name: "purge_apply", agent: {}, signal: { aborted: false } },
      async () => { nextCalled = true; return "next"; },
    );
    check("enforce + rejected does not dispatch", nextCalled === false && out.kind === "deny");
    check("deny audited with reason", readAudit().some((r) => r.decision === "deny" && r.why === "rejected"));
  }

  {
    const h = makeCtx("cancelled");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_revert", agent: {}, signal: { aborted: false } });
    check("enforce + cancelled maps to cancel", out.kind === "cancel");
  }
  {
    const h = makeCtx("something-else");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: false } });
    check("enforce + unknown outcome denies", out.kind === "deny" && /unavailable/.test(out.reason));
  }
  {
    const h = makeCtx("allowed-once", { withService: false });
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: false } });
    check("enforce + missing service denies", out.kind === "deny" && /approval service/.test(out.reason));
  }
  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", signal: { aborted: false } });
    check("enforce + missing agent denies", out.kind === "deny");
  }
  {
    const h = makeCtx("allowed-once", { throwOnRequest: true });
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: false } });
    check("enforce + throwing approval denies", out.kind === "deny" && /could not be confirmed/.test(out.reason));
  }
  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    const out = await runPre(h, { name: "purge_apply", agent: {}, signal: { aborted: true } });
    check("aborted signal cancels before requesting", out.kind === "cancel" && h.requests() === 0);
  }

  {
    const h = makeCtx("rejected");
    installToolGate(h.ctx, { mode: "enforce", auditPath: () => auditFile, fs, path });
    let nextCalled = false;
    await h.handlers["tools/pre-execute"][0](
      { name: "purge_status", signal: { aborted: false } },
      async () => { nextCalled = true; return "next"; },
    );
    check("ungated tool passes through even in enforce", nextCalled === true && h.requests() === 0);
  }

  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", approvalReuseMs: 60000, auditPath: () => auditFile, fs, path });
    const exec = () => ({ name: "purge_apply", arguments: { action: "prompt" }, agent: { id: "a1" }, signal: { aborted: false } });
    await runPre(h, exec());
    await runPre(h, exec());
    const audit = readAudit();
    check("same operation reuses approval within window", h.requests() === 1, "requests=" + h.requests());
    check("first approval audited", audit.some((r) => r.decision === "allow" && r.why === "allowed-once"));
    check("reused call still audited", audit.some((r) => r.decision === "allow" && r.why === "reused-approval"));
  }

  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", approvalReuseMs: 60000, auditPath: () => auditFile, fs, path });
    const exec = (action) => ({ name: "purge_apply", arguments: { action }, agent: { id: "a1" }, signal: { aborted: false } });
    await runPre(h, exec("one"));
    await runPre(h, exec("two"));
    check("different operation asks again", h.requests() === 2, "requests=" + h.requests());
  }

  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", approvalReuseMs: 60000, auditPath: () => auditFile, fs, path });
    const exec = (agentId) => ({ name: "purge_apply", arguments: { action: "prompt" }, agent: { id: agentId }, signal: { aborted: false } });
    await runPre(h, exec("a1"));
    await runPre(h, exec("a2"));
    check("different agent asks again", h.requests() === 2, "requests=" + h.requests());
  }

  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", approvalReuseMs: 20, auditPath: () => auditFile, fs, path });
    const exec = () => ({ name: "purge_apply", arguments: { action: "prompt" }, agent: { id: "a1" }, signal: { aborted: false } });
    await runPre(h, exec());
    await new Promise((resolve) => setTimeout(resolve, 40));
    await runPre(h, exec());
    check("expired approval asks again", h.requests() === 2, "requests=" + h.requests());
  }

  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", approvalReuseMs: 60000, auditPath: () => auditFile, fs, path });
    const exec = () => ({ name: "purge_apply", agent: {}, signal: { aborted: false } });
    await runPre(h, exec());
    await runPre(h, exec());
    check("anonymous agent never reuses approval", h.requests() === 2, "requests=" + h.requests());
  }

  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", approvalReuseMs: 60000, auditPath: () => auditFile, fs, path });
    const exec = () => ({ name: "purge_apply", arguments: { action: "prompt" }, agent: { id: "a1" }, signal: { aborted: false } });
    const results = await Promise.all([runPre(h, exec()), runPre(h, exec())]);
    check("concurrent duplicates share one prompt", h.requests() === 1, "requests=" + h.requests());
    check("both concurrent calls proceed", results.every((x) => x === "next"));
  }

  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { mode: "enforce", approvalReuseMs: 0, auditPath: () => auditFile, fs, path });
    const exec = () => ({ name: "purge_apply", arguments: { action: "prompt" }, agent: { id: "a1" }, signal: { aborted: false } });
    await runPre(h, exec());
    await runPre(h, exec());
    check("reuse disabled asks every time", h.requests() === 2, "requests=" + h.requests());
  }

  {
    fs.rmSync(auditFile, { force: true });
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { auditPath: () => auditFile, fs, path });
    const out = await h.handlers["tools/post-execute"][0](
      { name: "purge_apply" },
      { isError: false, value: { text: "done" } },
      async () => "next",
    );
    check("post-execute passes result through", out === "next");
    check("result audited", readAudit().some((r) => r.phase === "result" && r.detail === "done"));
  }
  {
    const h = makeCtx("allowed-once");
    installToolGate(h.ctx, { auditPath: () => path.join("Z:\\nope\\nested", "audit.jsonl"), fs, path });
    const out = await h.handlers["tools/post-execute"][0]({ name: "purge_apply" }, { value: {} }, async () => "next");
    check("unwritable audit path does not break result", out === "next");
  }

  {
    const h = makeCtx("allowed-once");
    const gate = installToolGate(h.ctx, { auditPath: () => auditFile, fs, path });
    check("two hooks installed", gate.installed === 2);
    gate.dispose();
    check("dispose removes hooks", h.handlers["tools/pre-execute"].length === 0 && h.handlers["tools/post-execute"].length === 0);
  }

  {
    check("allowed-once maps to allow", decisionFromOutcome("allowed-once").allow === true);
    check("cancelled maps to cancel", decisionFromOutcome("cancelled").kind === "cancel");
    check("rejected maps to deny", decisionFromOutcome("rejected").kind === "deny");
    check("unavailable maps to deny", decisionFromOutcome("unavailable").kind === "deny");
  }

  fs.rmSync(auditDir, { recursive: true, force: true });
}

console.log(`\n${fail === 0 ? "ALL PASS" : `${fail} FAILED`}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
