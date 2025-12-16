# deBridge Data Pipeline

A robust blockchain data collection and analysis pipeline for USDC transfer events on Ethereum Mainnet, orchestrated with Temporal workflows.

## Overview

This pipeline collects and analyzes USDC transfer events for a specific address, calculating gas-related metrics including:
- **7-day Moving Average (MA7)** of effective gas price
- **Daily Total Gas Cost** aggregation
- **Cumulative Gas Cost** over time

The pipeline uses **Temporal** for reliable workflow orchestration with automatic retries, resumability, and comprehensive observability.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Temporal Workflow Pipeline                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │   Ethereum   │────▶│   Temporal   │────▶│  ClickHouse  │    │
│  │   JSON-RPC   │     │   Workflow   │     │   Database   │    │
│  └──────────────┘     │              │     └──────────────┘    │
│         │             │   Activities  │            │           │
│         │             │   + Worker    │            ▼           │
│         │             └──────────────┘    ┌──────────────┐     │
│         │                    │            │   Analysis   │     │
│         │                    │            │    Engine    │     │
│         │                    ▼            └──────┬───────┘     │
│         │            ┌──────────────┐            │             │
│         │            │   Temporal   │            ▼             │
│         │            │      UI      │    ┌──────────────┐      │
│         │            └──────────────┘    │ JSON Reports │      │
│         │                    │           └──────────────┘      │
│         │                    ▼                                 │
│         │            ┌──────────────┐                          │
│         └───────────▶│  Prometheus  │                          │
│                      │   Metrics    │                          │
│                      └──────────────┘                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Components

1. **Blockchain Client (viem)**: Connects to Ethereum RPC for fetching transfer events and transaction receipts
2. **Temporal Workflows**: Orchestrates data collection with retry logic, heartbeats, and resumability
3. **Temporal Worker**: Executes workflow activities, exposes Prometheus metrics
4. **ClickHouse Database**: Time-series optimized storage with MergeTree engine and partitioning
5. **Analysis Engine**: Calculates gas metrics using SQL window functions
6. **Temporal UI**: Web interface for monitoring workflow execution
7. **Prometheus Metrics**: Real-time observability into pipeline health and performance

## Prerequisites

- Node.js >= 18.0.0
- Docker and Docker Compose (for containerized deployment)
- Ethereum RPC endpoint:
  - **Recommended**: [PublicNode](https://ethereum.publicnode.com) (free, no signup required)
  - Alternative: Infura, Alchemy, QuickNode (may require API keys or have stricter rate limits)

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd debridge-data-pipeline
npm install
```

Create `.env` file:
```bash
cp .env.example .env
```

Edit `.env` with your Ethereum RPC URL:

**PublicNode (Recommended - No API key needed):**
```env
ETH_RPC_URL=https://ethereum.publicnode.com
```

**Alternative Providers:**
- Infura: `https://mainnet.infura.io/v3/YOUR_PROJECT_ID`
- Alchemy: `https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY`
- LlamaRPC: `https://eth.llamarpc.com`

### 2. Start Infrastructure

```bash
# Start all services (MySQL, ClickHouse, Temporal, Worker)
docker compose up -d

# Wait for services to be healthy (~60 seconds)
docker compose ps
```

All services should show as "healthy" or "running":
- `debridge-mysql` - Temporal persistence
- `debridge-clickhouse` - Data storage
- `debridge-temporal` - Workflow server
- `debridge-temporal-ui` - Web UI
- `debridge-worker` - Workflow executor

### 3. Trigger Workflow

```bash
# Start the data collection workflow
docker compose up starter

# Or run locally:
npm run start:workflow
```

The workflow will:
1. Collect 5,000+ USDC transfer events
2. Calculate gas metrics (MA7, daily totals, cumulative)
3. Export analysis report to `./output/analysis_report.json`

## Monitoring the Pipeline

### 1. Temporal Web UI

**URL:** http://localhost:8080

Monitor workflow execution in real-time:
- Workflow status (Running, Completed, Failed)
- Activity progress and retries
- Execution history and timeline
- Event logs and error details

Navigate to: **Workflows** → Find your `collect-events-*` workflow

### 2. Prometheus Metrics

**Metrics Endpoint:** http://localhost:9091/metrics
**Health Check:** http://localhost:9091/health

The worker exposes comprehensive Prometheus metrics:

#### Available Metrics

**RPC Performance:**
- `debridge_rpc_request_duration_seconds{method}` - Histogram of RPC latency by method
  - Labels: `method` (eth_getLogs, eth_getTransactionReceipt, etc.)
  - Buckets: 0.1s, 0.5s, 1s, 2s, 5s, 10s

**Rate Limiting:**
- `debridge_rate_limit_hits_total` - Counter of rate limit errors encountered
- `debridge_retries_total{reason}` - Counter of retry attempts by reason

**Data Collection:**
- `debridge_events_collected_total` - Total USDC transfer events collected
- `debridge_blocks_processed_total` - Total Ethereum blocks scanned

**Database Operations:**
- `debridge_db_operations_total{operation}` - Database calls by type (insert, query)
- `debridge_db_operation_duration_seconds{operation}` - Database operation latency

**Pipeline Progress:**
- `debridge_pipeline_progress` - Gauge of completion (0.0 to 1.0)
- `debridge_current_block_number` - Current block being processed

**Node.js Metrics:**
- `process_cpu_user_seconds_total` - CPU usage
- `nodejs_heap_size_used_bytes` - Memory usage
- `nodejs_eventloop_lag_seconds` - Event loop lag

#### Example Prometheus Queries

```promql
# Average RPC latency over last 5m
rate(debridge_rpc_request_duration_seconds_sum[5m]) /
rate(debridge_rpc_request_duration_seconds_count[5m])

# Events collected per minute
rate(debridge_events_collected_total[1m]) * 60

# Pipeline completion percentage
debridge_pipeline_progress * 100

# P95 RPC latency by method
histogram_quantile(0.95,
  rate(debridge_rpc_request_duration_seconds_bucket[5m]))
```

#### Prometheus Scrape Configuration

Add to your `prometheus.yml`:
```yaml
scrape_configs:
  - job_name: 'debridge-pipeline'
    static_configs:
      - targets: ['localhost:9091']
    scrape_interval: 15s
```

### 3. ClickHouse Query Interface

**HTTP Interface:** http://localhost:8123
**Native Protocol:** localhost:9001

Query collected data directly:

```bash
# Using curl
curl 'http://localhost:8123/' --data-binary \
  "SELECT count() FROM debridge.transfer_events"

# Using clickhouse-client (if installed)
clickhouse-client --host localhost --port 9001 \
  --query "SELECT * FROM debridge.transfer_events LIMIT 10"
```

### 4. Worker Health Check

**Endpoint:** http://localhost:9091/health

Returns JSON with service status:
```json
{
  "status": "healthy",
  "timestamp": "2024-06-20T10:30:00.000Z",
  "uptime": 3600.5,
  "metrics": {
    "eventsCollected": 5072,
    "blocksProcessed": 581888,
    "rpcCalls": 150
  }
}
```

## Output Format

```json
{
  "address": "0xef4fb24ad0916217251f553c0596f8edc630eb66",
  "network": "ethereum-mainnet",
  "token": "USDC",
  "summary": {
    "events_collected": 5000,
    "blocks_scanned": [18000000, 19500000],
    "period_utc": ["2024-01-15", "2024-06-20"]
  },
  "daily_gas_cost": [
    { "date": "2024-01-15", "gas_cost_wei": "123456789000000000", "gas_cost_eth": 0.123456789 }
  ],
  "ma7_effective_gas_price": [
    { "date": "2024-01-15", "ma7_wei": "25000000000", "ma7_gwei": 25.0 }
  ],
  "cumulative_gas_cost_eth": [
    { "date": "2024-01-15", "cum_eth": 0.123456789 }
  ]
}
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `ETH_RPC_URL` | Ethereum JSON-RPC endpoint | Required |
| `TARGET_ADDRESS` | Address to filter transfers | `0xef4fb24ad0916217251f553c0596f8edc630eb66` |
| `USDC_CONTRACT` | USDC token contract | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| `MIN_EVENTS` | Minimum events to collect | `5000` |
| `BLOCK_BATCH_SIZE` | Blocks per batch | `2000` |
| `CLICKHOUSE_HOST` | ClickHouse hostname | `localhost` |
| `CLICKHOUSE_PORT` | ClickHouse HTTP port | `8123` |
| `TEMPORAL_ADDRESS` | Temporal server address | `localhost:7233` |

## Database Schema

### transfer_events Table

```sql
CREATE TABLE transfer_events (
  transaction_hash String,
  log_index UInt32,
  block_number UInt64,
  block_timestamp DateTime,
  from_address String,
  to_address String,
  value UInt256,
  gas_used UInt64,
  effective_gas_price UInt256,
  gas_cost UInt256,
  event_date Date DEFAULT toDate(block_timestamp)
)
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (block_timestamp, transaction_hash, log_index)
```

Key features:
- **ReplacingMergeTree**: Automatic deduplication for idempotency
- **Partitioning by month**: Efficient time-series queries
- **Bloom filter indexes**: Fast address filtering

## Key Design Decisions

### 1. Idempotency
- Uses `ReplacingMergeTree` engine for automatic deduplication
- Events are keyed by `(transaction_hash, log_index)`
- Safe to re-run pipeline without creating duplicates

### 2. Rate Limit Handling
- Exponential backoff with full jitter
- Configurable retry parameters
- Batch processing with delays between batches

### 3. Resumability
- Tracks last processed block in database
- Pipeline can resume from where it left off
- No data loss on interruption

### 4. Gas Metrics Calculation
- Uses `effectiveGasPrice` from transaction receipts (EIP-1559 compatible)
- SQL window functions for MA7 calculation
- Cumulative sums for running totals

## Project Structure

```
debridge-data-pipeline/
├── src/
│   ├── config/          # Configuration management
│   ├── blockchain/      # Ethereum client and event handling
│   ├── database/        # ClickHouse client, schema, queries
│   ├── temporal/        # Workflow orchestration
│   │   ├── activities/  # Temporal activities
│   │   └── workflows/   # Temporal workflows
│   ├── analysis/        # Metrics calculation
│   ├── commands/        # CLI entry points
│   └── utils/           # Shared utilities
├── output/              # Generated reports
├── docker-compose.yml   # Container orchestration
├── Dockerfile           # Application container
└── README.md
```


## Testing

```bash
npm run typecheck  # Type checking
npm run lint       # Linting
npm test           # Unit tests
```

## Troubleshooting

### RPC Provider Issues

**PublicNode Rate Limits**
If you encounter rate limit errors with PublicNode:
- Reduce `BLOCK_BATCH_SIZE` from 2000 to 1000
- Increase delays in `src/commands/pipeline.ts` (e.g., 200ms → 300ms)
- Try alternative public endpoints: `https://eth.llamarpc.com` or `https://1rpc.io/eth`

**Alchemy Error: "10 block range limit"**
```
Under the Free tier plan, you can make eth_getLogs requests with up to a 10 block range
```
- **Solution 1 (Recommended)**: Switch to PublicNode (no API key, no block range limit)
- **Solution 2**: Set `BLOCK_BATCH_SIZE=10` in `.env` (very slow: ~25 hours for 5K events)
- **Solution 3**: Upgrade to Alchemy paid plan

**Infura Error: "query returned more than 10000 results"**
```
query returned more than 10000 results. Try with this block range [...]
```
- Reduce `BLOCK_BATCH_SIZE` to 1000 or 500
- This error is rare for address-specific queries

### Rate Limit Errors
- **Balanced Mode Settings**: BLOCK_BATCH_SIZE=2000, delays=150-200ms
- **Conservative Mode**: BLOCK_BATCH_SIZE=1000, delays=300ms
- Check delays in `src/blockchain/client.ts` and `src/commands/pipeline.ts`

### Connection Timeout
- Check RPC endpoint health: `curl -X POST [RPC_URL] -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`
- Increase timeout in `src/blockchain/client.ts:20` (default: 30000ms)
- Try alternative RPC providers (PublicNode, LlamaRPC, 1RPC)

### Missing Events
- Verify target address has USDC activity on Etherscan
- Check block range covers expected period
- Ensure `TARGET_ADDRESS` is correctly configured

## License

MIT
