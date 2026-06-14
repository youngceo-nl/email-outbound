// CapSolver client for reCAPTCHA Enterprise.
// Docs: https://docs.capsolver.com/ — ReCaptchaV2Enterprise(ProxyLess)Task.
//
// solveRecaptchaEnterprise() creates a task, polls until it's ready, and returns
// the gRecaptchaResponse token to inject back into the page.

const CAPSOLVER_BASE = "https://api.capsolver.com";

export type SolveOpts = {
  apiKey: string;
  websiteURL: string;
  websiteKey: string;
  pageAction?: string;
  isInvisible?: boolean;
  proxy?: string | null; // "http://user:pass@host:port" — omit for ProxyLess
  timeoutMs?: number;
};

export async function solveRecaptchaEnterprise(opts: SolveOpts): Promise<string> {
  const { apiKey, websiteURL, websiteKey, pageAction, isInvisible = false, proxy = null, timeoutMs = 120_000 } = opts;
  if (!apiKey) throw new Error("CapSolver: missing apiKey");
  if (!websiteKey) throw new Error("CapSolver: missing websiteKey");

  const task: Record<string, unknown> = {
    type: proxy ? "ReCaptchaV2EnterpriseTask" : "ReCaptchaV2EnterpriseTaskProxyLess",
    websiteURL,
    websiteKey,
    isInvisible,
  };
  if (pageAction) task.pageAction = pageAction;
  if (proxy) task.proxy = proxy;

  const create = await capPost("/createTask", { clientKey: apiKey, task });
  if (create.errorId) throw new Error(`CapSolver createTask failed: ${create.errorCode} ${create.errorDescription ?? ""}`);
  const taskId = create.taskId as string | undefined;
  if (!taskId) throw new Error("CapSolver: no taskId returned");

  const deadline = Date.now() + timeoutMs;
  await sleep(1500);
  while (Date.now() < deadline) {
    const res = await capPost("/getTaskResult", { clientKey: apiKey, taskId });
    if (res.errorId) throw new Error(`CapSolver getTaskResult failed: ${res.errorCode} ${res.errorDescription ?? ""}`);
    if (res.status === "ready") {
      const token = (res.solution as { gRecaptchaResponse?: string } | undefined)?.gRecaptchaResponse;
      if (!token) throw new Error("CapSolver: ready but no gRecaptchaResponse");
      return token;
    }
    await sleep(2000);
  }
  throw new Error(`CapSolver: timed out after ${timeoutMs}ms`);
}

async function capPost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${CAPSOLVER_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CapSolver HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
