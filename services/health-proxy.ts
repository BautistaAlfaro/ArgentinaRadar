/**
 * Health-proxy — lightweight server that responds to GET /health
 * on all development ports needed by ArgentinaRadar.
 *
 * When a real service is down (e.g. Python services, Redis-dependent),
 * this proxy ensures the /health endpoint returns "ok" so monitoring
 * and service-to-service calls don't break during local dev.
 */

import http from "http";

const PORTS: number[] = [
  3001, // news-ingestion
  3002, // geolocation
  3004, // twitter-publisher
  3006, // economic-data
  3007, // alerts
  3008, // event-detector
  3009, // trend-analyzer
  3012, // admin
  3013, // ai-processor
  5173, // frontend (Vite)
];

const serviceNames: Record<number, string> = {
  3001: "news-ingestion",
  3002: "geolocation",
  3004: "twitter-publisher",
  3006: "economic-data",
  3007: "alerts",
  3008: "event-detector",
  3009: "trend-analyzer",
  3012: "admin",
  3013: "ai-processor",
  5173: "frontend",
};

const startTime = Date.now();

for (const port of PORTS) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: serviceNames[port] ?? `service-${port}`,
        uptime: Math.floor((Date.now() - startTime) / 1000),
        port,
        proxy: true,
        timestamp: new Date().toISOString(),
      }),
    );
  });

  server.listen(port, () => {
    console.log(`[health-proxy] ${serviceNames[port] ?? port} → http://localhost:${port}/health`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // Port already in use by a real service — that's fine
      console.log(`[health-proxy] Port ${port} already in use — skipping`);
    } else {
      console.error(`[health-proxy] Error on port ${port}:`, err.message);
    }
  });
}

console.log(`\n[health-proxy] Started on ${PORTS.length} ports at ${new Date().toISOString()}\n`);
