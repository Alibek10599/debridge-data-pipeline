# deBridge Data Pipeline

A robust blockchain data collection and analysis pipeline for USDC transfer events on Ethereum Mainnet.

## Overview

This pipeline collects and analyzes USDC transfer events for a specific address, calculating gas-related metrics including:
- **7-day Moving Average (MA7)** of effective gas price
- **Daily Total Gas Cost** aggregation
- **Cumulative Gas Cost** over time

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Data Pipeline                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
│  │   Ethereum   │────▶│   Temporal   │────▶│  ClickHouse  │    │
│  │   JSON-RPC   │     │   Workflow   │     │   Database   │    │
│  └──────────────┘     └──────────────┘     └──────────────┘    │
│         │                    │                    │             │
│         │                    │                    ▼             │
│         │                    │           ┌──────────────┐       │
│         │                    │           │   Analysis   │       │
│         │                    │           │    Engine    │       │
│         └────────────────────┘           └──────┬───────┘       │
│                                                  │              │
│                                                  ▼              │
│                                          ┌──────────────┐       │
│                                          │  JSON Export │       │
│                                          └──────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Components

1. **Blockchain Client (viem)**: Connects to Ethereum RPC for fetching transfer events and transaction receipts
2. **Temporal Workflows**: Orchestrates data collection with retry logic, heartbeats, and resumability
3. **ClickHouse Database**: Time-series optimized storage with MergeTree engine and partitioning
4. **Analysis Engine**: Calculates gas metrics using SQL window functions

## Prerequisites

- Node.js >= 18.0.0
- Docker and Docker Compose (for containerized deployment)
- Ethereum RPC endpoint:
  - **Recommended**: [PublicNode](https://ethereum.publicnode.com) (free, no signup required)
  - Alternative: Infura, Alchemy, QuickNode (may require API keys or have stricter rate limits)

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd debridge-data-pipeline
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

**For PublicNode (Recommended - No API key needed):**
```env
ETH_RPC_URL=https://ethereum.publicnode.com
BLOCK_BATCH_SIZE=2000
```

**Alternative Options:**

*Infura (requires free account):*
```env
ETH_RPC_URL=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
BLOCK_BATCH_SIZE=2000
```

*Alchemy (free tier very limited):*
```env
ETH_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
BLOCK_BATCH_SIZE=10  # Free tier requires small batches
```

### 3. Run with Docker (Recommended)

```bash
# Start infrastructure (ClickHouse, Temporal)
docker-compose up -d clickhouse temporal temporal-ui

# Wait for services to be ready (~30 seconds)
sleep 30

# Run the standalone pipeline
docker-compose --profile pipeline up pipeline
```

### 4. Run Locally (Development)

```bash
# Start ClickHouse only
docker-compose up -d clickhouse

# Validate setup before running
npm run validate

# Run standalone pipeline
npm run pipeline
```

## Usage

### Standalone Pipeline (Recommended for Testing)

The standalone pipeline runs without Temporal and is simpler for local testing:

```bash
npm run pipeline
```

### Temporal-Based Pipeline (Production)

For production deployments with workflow orchestration:

```bash
# Terminal 1: Start worker
npm run dev:worker

# Terminal 2: Start collection
npm run collect
```

### Export Analysis Report

```bash
npm run export [output_path]
```

Default output: `./output/analysis_report.json`

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

## Monitoring

### Temporal UI

Access Temporal UI at http://localhost:8080 to monitor workflow execution.

### Prometheus Metrics

The project provides two monitoring approaches depending on execution mode:

#### Standalone Pipeline (Short-lived)

When running `npm run pipeline`, metrics are **collected and displayed at completion**:

```bash
npm run pipeline

# At end of pipeline run:
# 📊 METRICS SUMMARY
# ==================
# 🌐 RPC Calls: 150 total, 245ms avg latency
# 📦 Events: 5,072 collected
# ⛓️  Blocks: 581,888 processed
```

**Output Files:**
- `output/analysis_report.json` - Analysis results (MA7, gas costs, etc.)
- `output/metrics.json` - Prometheus metrics summary + raw data

**No live metrics server** - pipeline runs for ~3 minutes and exits with summary.

#### Temporal Worker (Long-running)

When running `npm run dev:worker`, metrics are **exposed via HTTP endpoint**:

**Metrics Endpoints:**
- `http://localhost:9091/metrics` - Prometheus scrape endpoint
- `http://localhost:9091/health` - Health check JSON

**Available Metrics:**
- `debridge_rpc_request_duration_seconds` - RPC request latency by method
- `debridge_rate_limit_hits_total` - Total rate limit errors encountered
- `debridge_retries_total` - Total retry attempts by reason
- `debridge_events_collected_total` - Total events collected
- `debridge_blocks_processed_total` - Total blocks processed
- `debridge_db_operations_total` - Database operations by type
- `debridge_pipeline_progress` - Current pipeline progress (0-1)
- `debridge_current_block_number` - Current block being processed
- Plus default Node.js metrics (CPU, memory, event loop lag)

**Prometheus Scrape Config:**
```yaml
scrape_configs:
  - job_name: 'debridge-worker'
    static_configs:
      - targets: ['localhost:9091']
    scrape_interval: 15s
```

**Standalone Metrics Server** (for testing):
```bash
npm run metrics
# Exposes metrics at http://localhost:9090/metrics
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
