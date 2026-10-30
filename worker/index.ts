import { securityHeaders } from "../lib/readwind/security";
import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async fetch(
    request: Request,
    env: Cloudflare.Env,
    ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>,
  ) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt)
            return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return {
              status: "request_context_expired",
              message: "This request has expired. Please try again.",
            };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const result = await runWithConnectorBinding(binding, () =>
      handler.fetch(request, env, ctx),
    );
    const response = new Response(result.body, result);
    for (const [key, value] of Object.entries(securityHeaders)) {
      if (!response.headers.has(key)) response.headers.set(key, value);
    }
    response.headers.delete("x-powered-by");
    if (new URL(request.url).pathname.startsWith("/api/")) {
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Vary", "Cookie");
    }
    return response;
  },
};

export default worker;
