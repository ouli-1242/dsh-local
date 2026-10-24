// Windows 0.2.1-rc.2 上两个静默失败的回归测试。
//
// A. `hostFs` 没暴露 fd 级同步方法：备份占位文件的 closeSync 抛错被吞，
//    rename 随即 EPERM，`.dshpurge.bak` 永远不会生成；shim 文本也永远读不到。
// B. 同步的 repair 路径如果调用异步 copy 且漏 await，rejection 会逃出 catch
//    并终止宿主（Node >= 15）。本仓库用 atomicCopyFileSync 保持同步。
//
// usage: node test/hostfs-sync.mjs [pluginDir]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = process.argv[2] || path.resolve(here, "..");
const load = (name) => import(pathToFileURL(path.join(pluginDir, "lib", name)).href);

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

const { hostFs } = await load("extract-asar.js");
const core = await load("core.js");

console.log("\n== hostFs exposes the fd-based sync surface ==");
for (const file of ["core.js", "index.js", "desktop.js", "hooks-deny.js"]) {
  const src = fs.readFileSync(path.join(pluginDir, "lib", file), "utf8");
  const used = new Set([...src.matchAll(/\bfs\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
  const missing = [...used].filter((m) => typeof hostFs[m] !== "function");
  check(`${file}: no fs.* call resolves to undefined`, missing.length === 0, missing.join(", "));
}

check("closeSync is a function", typeof hostFs.closeSync === "function");
check("readSync is a function", typeof hostFs.readSync === "function");
check("fsyncSync is a function", typeof hostFs.fsyncSync === "function");

console.log("\n== fd args never reach the asar probe ==");
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-hostfs-"));
  try {
    const file = path.join(tmpDir, "probe.txt");
    const fd = hostFs.openSync(file, "w");
    check("openSync returns an fd", Number.isInteger(fd) && fd >= 0);
    hostFs.writeSync(fd, "hello", 0, "utf8");
    hostFs.fsyncSync(fd);
    check("closeSync actually closes (no throw)", (() => {
      try { hostFs.closeSync(fd); return true; } catch { return false; }
    })());

    let closedRejected = false;
    try { hostFs.closeSync(fd); } catch { closedRejected = true; }
    check("double close is rejected (fd was really released)", closedRejected);

    const rfd = hostFs.openSync(file, "r");
    const buf = Buffer.allocUnsafe(16);
    const n = hostFs.readSync(rfd, buf, 0, 16, 0);
    hostFs.closeSync(rfd);
    check("readSync reads the written bytes", buf.subarray(0, n).toString("utf8") === "hello");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log("\n== placeholder backup path no longer leaks an fd ==");
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-bak-"));
  try {
    const src = path.join(tmpDir, "target.js");
    fs.writeFileSync(src, "original");
    const bak = src + ".dshpurge.bak";

    const placeholderFd = hostFs.openSync(bak, "wx");
    let closed = false;
    try { hostFs.closeSync(placeholderFd); closed = true; } catch { /* pre-fix path */ }
    check("placeholder fd closed", closed);

    let copied = false;
    try {
      await core.atomicCopyFile(src, bak);
      copied = true;
    } catch { /* pre-fix: EPERM while the fd was open */ }
    check("atomicCopyFile succeeds over the closed placeholder", copied);
    check("backup content matches source", fs.readFileSync(bak, "utf8") === "original");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log("\n== isTextShim reads shim text again ==");
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-shim-"));
  try {
    const cmd = path.join(tmpDir, "dsh.cmd");
    fs.writeFileSync(cmd, "@echo off\r\nsetlocal\r\n");
    check("text shim is not reported as binary", core.shimFileStatus(cmd) !== "binary");
    check("unpatched shim reports original", core.shimFileStatus(cmd) === "original");

    const patched = path.join(tmpDir, "patched.cmd");
    fs.writeFileSync(patched, "@echo off\r\nrem dsh-purge shim\r\n");
    check("patched shim is detected", core.shimIsPatched(patched) === true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

console.log("\n== repairOfficialCliAfterUnpack stays synchronous ==");
{
  const desktop = await load("desktop.js");
  check("desktop.repairOfficialCliAfterUnpack is sync",
    desktop.repairOfficialCliAfterUnpack.constructor.name === "Function");
  check("core.repairOfficialCliAfterUnpack is sync",
    core.repairOfficialCliAfterUnpack.constructor.name === "Function");

  let threw = null;
  try {
    const result = core.repairOfficialCliAfterUnpack(null);
    check("returns a report instead of throwing for a null exe",
      result && typeof result === "object" && result.ok === false, JSON.stringify(result));
  } catch (error) {
    threw = error;
    check("returns a report instead of throwing for a null exe", false, String(threw && threw.message));
  }
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
