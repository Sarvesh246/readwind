import { createServer } from "vite";
import { chromium } from "@playwright/test";
let server, browser;
export async function prepare(payload) {
  if (!server) {
    server = await createServer({
      configFile: false,
      root: process.cwd(),
      resolve: { alias: { "@": process.cwd() } },
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
        fs: { strict: true, allow: [process.cwd()] },
        watch: { ignored: ["**/.next/**", "**/work/**"] },
      },
    });
    await server.listen();
    browser = await chromium.launch();
  }
  const address = server.httpServer.address(),
    origin = `http://127.0.0.1:${address.port}`,
    page = await browser.newPage();
  try {
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === origin || ["blob:", "data:"].includes(url.protocol)
        ? route.continue()
        : route.abort();
    });
    await page.goto(`${origin}/scripts/catalog/harness.html`);
    await page.waitForFunction(
      () => typeof window.prepareReadwindBook === "function",
    );
    let timer;
    try {
      return await Promise.race([
        page.evaluate(
          (payload) => window.prepareReadwindBook(payload),
          payload,
        ),
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error("Book preparation exceeded its 20-minute limit."),
              ),
            20 * 60 * 1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await page.close();
  }
}
export async function closePreparation() {
  await browser?.close();
  await server?.close();
  browser = server = undefined;
}
export const preparationVersion = "6";
