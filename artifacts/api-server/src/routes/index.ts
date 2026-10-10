import type { IncomingMessage, ServerResponse } from "node:http";
import { handleHealthCheck } from "./health";
import { handleVoteWebhook } from "../bot/voting";

export function handleApiRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/api/healthz") {
    handleHealthCheck(res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/webhooks/topgg") {
    void handleVoteWebhook(req, res, "topgg");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/webhooks/discadia") {
    void handleVoteWebhook(req, res, "discadia");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`Cannot ${req.method ?? "GET"} ${url.pathname}`);
}
