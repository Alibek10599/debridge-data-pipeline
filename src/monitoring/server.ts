import http from 'http';
import { getMetrics, getContentType } from './metrics';
import { healthCheck as clickhouseHealth } from '../database/clickhouse';
import { getCurrentBlockNumber } from '../blockchain/client';
import { createChildLogger } from '../utils/logger';

const logger = createChildLogger('metrics-server');

const PORT = process.env.METRICS_PORT || 9090;

/**
 * Create a lightweight HTTP server for Prometheus metrics
 */
export function createMetricsServer() {
  const server = http.createServer(async (req, res) => {
    // Health check endpoint
    if (req.url === '/health') {
      try {
        const chHealthy = await clickhouseHealth();
        const rpcHealthy = await getCurrentBlockNumber().then(() => true).catch(() => false);

        const healthy = chHealthy && rpcHealthy;
        const status = healthy ? 200 : 503;

        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: healthy ? 'healthy' : 'unhealthy',
          clickhouse: chHealthy ? 'ok' : 'error',
          rpc: rpcHealthy ? 'ok' : 'error',
          timestamp: new Date().toISOString(),
        }));
      } catch (error) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        }));
      }
      return;
    }

    // Metrics endpoint
    if (req.url === '/metrics') {
      try {
        const metrics = await getMetrics();
        res.writeHead(200, { 'Content-Type': getContentType() });
        res.end(metrics);
      } catch (error) {
        logger.error({ error }, 'Failed to generate metrics');
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error generating metrics');
      }
      return;
    }

    // Root endpoint - simple info page
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head><title>deBridge Data Pipeline Metrics</title></head>
          <body>
            <h1>deBridge Data Pipeline - Metrics Server</h1>
            <ul>
              <li><a href="/metrics">/metrics</a> - Prometheus metrics endpoint</li>
              <li><a href="/health">/health</a> - Health check endpoint</li>
            </ul>
          </body>
        </html>
      `);
      return;
    }

    // 404 for other routes
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'Metrics server started');
    logger.info(`Metrics available at http://localhost:${PORT}/metrics`);
    logger.info(`Health check at http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down metrics server');
    server.close(() => {
      logger.info('Metrics server closed');
      process.exit(0);
    });
  });

  return server;
}

// Start server if run directly
if (require.main === module) {
  createMetricsServer();
}
