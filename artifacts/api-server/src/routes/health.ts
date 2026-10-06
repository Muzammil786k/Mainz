import type { ServerResponse } from "node:http";
import { HealthCheckResponse } from "@workspace/api-zod";

export function handleHealthCheck(res: ServerResponse): void {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
