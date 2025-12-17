# deBridge Data Pipeline

A robust blockchain data collection and analysis pipeline for USDC transfer events on Ethereum Mainnet, orchestrated with Temporal workflows.

## 📚 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Detailed system architecture, design decisions, and technical specifications
- **[README.md](./README.md)** - Quick start guide and usage instructions (you are here)

## 📊 Monitoring & Visualizations

This pipeline includes comprehensive monitoring and visualization tools:

| Tool | URL | Purpose |
|------|-----|---------|
| **📊 Grafana Dashboard** | http://localhost:3000 | Real-time metrics (8 panels, auto-provisioned) |
| **📈 Prometheus UI** | http://localhost:9092 | Metric queries and time-series visualization |
| **🌐 Temporal UI** | http://localhost:8080 | Workflow execution monitoring |
| **📄 Interactive Dashboard** | `./output/dashboard.html` | Gas cost analysis (MA7, daily, cumulative) |
| **💾 JSON Export** | `./output/analysis_report.json` | Complete analysis data |

**All visualizations are included** - no additional setup required!

## Overview

This pipeline collects and analyzes **recent USDC transfer events (last 30 days)** for a specific address, calculating gas-related metrics including:
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
1. Collect 7,000+ USDC transfer events from the last 30 days
2. Calculate gas metrics (MA7, daily totals, cumulative)
3. Export analysis report to `./output/analysis_report.json`

### 4. View Analysis Results

After the workflow completes, you can access the analysis results in two ways:

#### 📊 Interactive Dashboard (Recommended for Reviewers!)

**Location:** `./output/dashboard.html`

**How to view:**
```bash
# Option 1: Open directly in browser
open output/dashboard.html

# Option 2: Use a simple HTTP server
cd output
python3 -m http.server 8000
# Then open http://localhost:8000/dashboard.html
```

**What you'll see:**
- 📈 **Daily Gas Cost Chart** - Bar chart showing gas costs per day in ETH
- 📉 **7-Day Moving Average** - Line chart of gas price trends in Gwei
- 📊 **Cumulative Gas Cost** - Area chart showing total accumulated costs
- 📋 **Summary Cards** - Events collected, blocks scanned, date range

The dashboard is self-contained and works offline. All data is loaded from `analysis_report.json`.

#### 📄 Raw JSON Report

**Location:** `./output/analysis_report.json`

```bash
cat output/analysis_report.json | jq
```

Contains all calculated metrics in JSON format for programmatic access.

## Monitoring the Pipeline

### 1. 📊 Grafana Dashboard (Recommended for Reviewers!)

**URL:** http://localhost:3000

**Pre-configured dashboard** showing real-time metrics:
- 📈 Events collected counter
- 🚀 RPC request rates and latency percentiles (p50, p95, p99)
- 💾 Memory usage (RSS, Heap)
- ⚡ Event loop lag
- 🔄 Rate limits and retry counts
- 📦 Current block number
- 📊 Pipeline progress gauge (0-100%)
- 📉 Database operation latency

**Quick Access:**
- **Username:** `admin` / **Password:** `admin`
- **Or browse anonymously** (viewer mode enabled)
- Dashboard auto-loads on first visit - no setup required!

**Dashboard Panels Overview:**

The Grafana dashboard includes 8 real-time monitoring panels:

1. **Events Collected** - Running total with color thresholds (green when target reached)
2. **RPC Requests Rate** - Time series of requests per second to Ethereum RPC
3. **Pipeline Progress** - Gauge showing completion percentage (0-100%)
4. **RPC Latency Distribution** - Multi-line graph showing p50, p95, p99 latencies
5. **Memory Usage** - RSS and Heap memory consumption over time
6. **Event Loop Lag** - Node.js event loop performance metrics
7. **Rate Limits & Retries** - Counters for rate limit hits and retry attempts
8. **Current Block Number** - Latest block being processed

**How to Access:**
```bash
# Start the pipeline
docker compose up -d

# Open Grafana in your browser
open http://localhost:3000

# Navigate to: Dashboards → DeBridge Pipeline
# Or use anonymous access (no login required)
```

### 2. Prometheus Metrics & Queries

**Prometheus UI:** http://localhost:9092
**Worker Metrics Endpoint:** http://localhost:9091/metrics
**Health Check:** http://localhost:9091/health

The worker exposes comprehensive Prometheus metrics in real-time.

**Quick Metric Visualization:**

You can visualize metrics directly in Prometheus UI by navigating to http://localhost:9092/graph and trying these queries:

```promql
# Events collection rate (events per minute)
rate(debridge_events_collected_total[1m]) * 60

# Average RPC latency over 5 minutes
rate(debridge_rpc_request_duration_seconds_sum[5m]) /
rate(debridge_rpc_request_duration_seconds_count[5m])

# Pipeline completion percentage
debridge_pipeline_progress * 100

# Memory usage in MB
debridge_process_resident_memory_bytes / 1024 / 1024

# P95 RPC latency by method
histogram_quantile(0.95,
  rate(debridge_rpc_request_duration_seconds_bucket[5m]))
```

**Sample Metrics Output:**

```
# HELP debridge_events_collected_total Total number of events collected
debridge_events_collected_total 7108

# HELP debridge_blocks_processed_total Total number of blocks processed
debridge_blocks_processed_total 48024

# HELP debridge_pipeline_progress Pipeline progress from 0 to 1
debridge_pipeline_progress 1

# HELP debridge_rpc_request_duration_seconds Duration of RPC requests
debridge_rpc_request_duration_seconds_count{method="eth_getLogs"} 150
debridge_rpc_request_duration_seconds_sum{method="eth_getLogs"} 450.123
```

### 3. Temporal Web UI

**URL:** http://localhost:8080

Monitor workflow execution in real-time:
- Workflow status (Running, Completed, Failed)
- Activity progress and retries
- Execution history and timeline
- Event logs and error details

Navigate to: **Workflows** → Find your `collect-events-*` workflow

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

## 📤 Output Files & Deliverables

All output files are generated in the `./output/` directory and are accessible on your host machine.

### Output File Locations

| File | Location | Description |
|------|----------|-------------|
| **JSON Report** | `./output/analysis_report.json` | Complete analysis data (2.8KB) |
| **Dashboard** | `./output/dashboard.html` | Interactive visualizations (10KB) |

**Absolute Path Example:**
```
/Users/alibekkhojabekov/Downloads/debridge-data-pipeline 2/output/analysis_report.json
```

**Quick Access:**
```bash
# View JSON report
cat output/analysis_report.json | jq

# Open interactive dashboard
open output/dashboard.html

# Copy to another location
cp output/analysis_report.json ~/Desktop/
```

## Output Format

**Location:** `./output/analysis_report.json`

**Example output:**

```json
{
  "address": "0xef4fb24ad0916217251f553c0596f8edc630eb66",
  "network": "ethereum-mainnet",
  "token": "USDC",
  "summary": {
    "events_collected": 7108,
    "blocks_scanned": [23817616, 23865589],
    "period_utc": ["2025-11-17", "2025-11-24"]
  },
  "daily_gas_cost": [
    { "date": "2025-11-17", "gas_cost_wei": "277105317864334090", "gas_cost_eth": 0.277105317864334 },
    { "date": "2025-11-18", "gas_cost_wei": "298914517281505615", "gas_cost_eth": 0.298914517281506 }
  ],
  "ma7_effective_gas_price": [
    { "date": "2025-11-17", "ma7_wei": "1030437158", "ma7_gwei": 1.030437158 },
    { "date": "2025-11-18", "ma7_wei": "859704742", "ma7_gwei": 0.859704742 }
  ],
  "cumulative_gas_cost_eth": [
    { "date": "2025-11-17", "cum_eth": 0.277105317864334 },
    { "date": "2025-11-18", "cum_eth": 0.576019835145840 }
  ]
}
```

See `./output/dashboard.html` for interactive visualizations of this data.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `ETH_RPC_URL` | Ethereum JSON-RPC endpoint | Required |
| `TARGET_ADDRESS` | Address to filter transfers | `0xef4fb24ad0916217251f553c0596f8edc630eb66` |
| `USDC_CONTRACT` | USDC token contract | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| `MIN_EVENTS` | Minimum events to collect | `7000` |
| `BLOCK_BATCH_SIZE` | Blocks per batch | `2000` |
| `CLICKHOUSE_HOST` | ClickHouse hostname | `clickhouse` |
| `CLICKHOUSE_PORT` | ClickHouse HTTP port | `8123` |
| `TEMPORAL_ADDRESS` | Temporal server address | `temporal:7233` |
| `METRICS_PORT` | Prometheus metrics port | `9091` |

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
