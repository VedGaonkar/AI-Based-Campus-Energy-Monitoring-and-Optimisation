// Small local smoke-test driver using Chrome's documented DevTools Protocol.
// Uses an isolated headless profile; never attaches to a user's browsing session.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function launchChrome(executablePath) {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const profile = `${process.cwd()}/.local/chrome-${randomUUID()}`;
  await mkdir(profile, { recursive: true });
  const processHandle = spawn(
    executablePath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  await writeFile(
    ".local/chrome-session.json",
    JSON.stringify({
      pid: processHandle.pid,
      port,
      profile,
      at: new Date().toISOString(),
    }),
  );
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
        method: "PUT",
      }).then((r) => r.json());
      if (target.webSocketDebuggerUrl) break;
    } catch {}
    await delay(100);
  }
  if (!target?.webSocketDebuggerUrl) {
    processHandle.kill();
    throw new Error(
      "Headless Chrome did not expose its local debugging endpoint",
    );
  }
  const first = await attachPage(target, processHandle);
  const pages = [first];
  return {
    newPage: async ({ viewport }) => { await first.page.setViewportSize(viewport); return first.page; },
    newTab: async ({ viewport }) => {
      const row = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
      const attached = await attachPage(row, processHandle); pages.push(attached); await attached.page.setViewportSize(viewport); return attached.page;
    },
    close: async () => { try { await first.send("Browser.close"); } catch {} for (const attached of pages) attached.socket.close(); if (processHandle.exitCode === null) processHandle.kill(); },
  };
}
async function attachPage(target, processHandle) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map(),
    handlers = {};
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(message.id);
        message.error
          ? p.reject(new Error(message.error.message))
          : p.resolve(message.result);
      }
    } else if (message.method === "Runtime.exceptionThrown")
      handlers.pageerror?.(new Error(message.params.exceptionDetails.text));
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Chrome command timed out: ${method}`));
        }, 20000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (fn, arg) => {
    const result = await send("Runtime.evaluate", {
      expression: `(${fn.toString()})(${JSON.stringify(arg) ?? ""})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        "Browser evaluation failed: " + result.exceptionDetails.text,
      );
    return result.result?.value;
  };
  const query = async (spec, operation, value) =>
    evaluate(
      ({ spec, operation, value }) => {
        let elements;
        if (spec.selector)
          elements = [...document.querySelectorAll(spec.selector)];
        else if (spec.label)
          elements = [...document.querySelectorAll("label")]
            .filter((l) => {
              const s = l.querySelector("span");
              return (s?.textContent ?? l.textContent).trim() === spec.label;
            })
            .map((l) => l.querySelector("input,select,textarea"))
            .filter(Boolean);
        else if (spec.alt)
          elements = [...document.querySelectorAll("img")].filter(
            (i) => i.alt === spec.alt,
          );
        else {
          const selectors = {
            heading: "h1,h2,h3,h4,h5,h6",
            button: "button,[role=button]",
            link: "a",
            checkbox: "input[type=checkbox]",
          };
          elements = [...document.querySelectorAll(selectors[spec.role])];
          if (spec.name)
            elements = elements.filter((e) => {
              const text = (
                e.getAttribute("aria-label") ?? e.textContent
              ).trim();
              return spec.exact ? text === spec.name : text.includes(spec.name);
            });
        }
        const element = elements[spec.index ?? 0];
        if (!element || !element.getClientRects().length) return false;
        if (operation === "exists") return true;
        if (element.disabled) return false;
        if (operation === "click" || operation === "check") {
          if (operation !== "check" || !element.checked) element.click();
          return true;
        }
        const prototype =
          element.tagName === "SELECT"
            ? HTMLSelectElement.prototype
            : element.tagName === "TEXTAREA"
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value").set.call(
          element,
          value,
        );
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      { spec, operation, value },
    );
  const locator = (spec) => {
    const run = async (operation, value) => {
      for (let i = 0; i < 200; i++) {
        if (await query(spec, operation, value)) return;
        await delay(100);
      }
      throw new Error(
        `Browser element unavailable: ${spec.name ?? spec.label ?? spec.selector ?? spec.alt ?? spec.role}`,
      );
    };
    return {
      first: () => locator({ ...spec, index: 0 }),
      click: () => run("click"),
      check: () => run("check"),
      fill: (value) => run("fill", value),
      selectOption: (value) => run("select", value),
      waitFor: () => run("exists"),
    };
  };
  try {
    await send("Page.enable");
    await send("Runtime.enable");
  } catch (err) {
    socket.close();
    processHandle.kill();
    throw err;
  }
  const page = {
    evaluate,
    pressKey: async (key) => { const params = { key, code: key, windowsVirtualKeyCode: ({ Tab: 9, Enter: 13, Escape: 27 })[key] }; await send("Input.dispatchKeyEvent", { ...params, type: "keyDown", ...(key === "Enter" ? { text: "\r" } : {}) }); await send("Input.dispatchKeyEvent", { ...params, type: "keyUp" }); },
    bringToFront: () => send("Page.bringToFront"),
    setOffline: async offline => { await send("Network.enable"); await send("Network.emulateNetworkConditions", { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); },
    on: (name, handler) => {
      handlers[name] = handler;
    },
    goto: async (url) => {
      await send("Page.navigate", { url });
      await delay(150);
    },
    getByLabel: (label) => locator({ label }),
    getByRole: (role, { name, exact = true } = {}) =>
      locator({ role, name, exact }),
    getByAltText: (alt) => locator({ alt }),
    locator: (selector) => locator({ selector }),
    setViewportSize: ({ width, height }) =>
      send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      }),
    screenshot: async ({ path, fullPage, selector }) => {
      const metrics = await send("Page.getLayoutMetrics");
      const size = metrics.cssContentSize ?? metrics.contentSize;
      const elementClip = selector ? await evaluate((selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height, scale: 1 };
      }, selector) : null;
      const image = await send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: !!fullPage || !!selector,
        ...(elementClip ? { clip: elementClip } : fullPage
          ? {
              clip: {
                x: 0,
                y: 0,
                width: size.width,
                height: size.height,
                scale: 1,
              },
            }
          : {}),
      });
      await writeFile(path, Buffer.from(image.data, "base64"));
    },
  };
  return { page, send, socket };
}
