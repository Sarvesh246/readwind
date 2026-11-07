import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

// Run against a production build served at this origin (or set READWIND_OFFLINE_ORIGIN).
// The reader.localhost hostname keeps Readwind's service worker enabled.
const origin = process.env.READWIND_OFFLINE_ORIGIN || "http://reader.localhost:8787";
const workers = readdirSync("dist/client/_next/static/workers").filter(name => name.endsWith(".js") && readFileSync(`dist/client/_next/static/workers/${name}`, "utf8").includes("piper_phonemize.data"));
assert.equal(workers.length, 1, "Expected one built speech worker");
const workerUrl = `/_next/static/workers/${workers[0]}`;
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP reader.localhost 127.0.0.1"] });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const generate = () => page.evaluate(url => new Promise((resolve, reject) => {
    const worker = new Worker(url, { type: "module" });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error("Piper timed out")); }, 120000);
    const finish = (error, bytes) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(new Error(error));
      else resolve(bytes);
    };
    worker.onerror = event => finish(event.message || "Piper worker failed to start");
    worker.onmessage = ({ data }) => {
      if (data.type === "ready") worker.postMessage({ type: "generate", id: 1, text: "This is a test of the reading voice.", voice: "en_US-ljspeech-medium" });
      if (data.type === "audio") finish(null, data.buffer.byteLength);
      if (data.type === "error") finish(data.message);
    };
    worker.postMessage({ type: "load" });
  }), workerUrl);
  assert.ok(await generate() > 44, "Online synthesis should produce audio");
  await context.setOffline(true);
  await page.reload();
  assert.ok(await generate() > 44, "A fresh worker should produce audio after an offline reload");
  console.log("Piper generated audio online and after an offline reload.");
} finally {
  await browser.close();
}
