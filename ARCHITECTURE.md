# Architecture Overview

## System Design

This document describes the key architectural decisions for the deBridge USDC Transfer Events data pipeline.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   Temporal Workflow-Orchestrated Pipeline                │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────┐        ┌──────────────┐        ┌─────────────┐
│  Ethereum   │───────▶│   Temporal   │───────▶│ ClickHouse  │
│  JSON-RPC   │  RPC   │   Workflow   │ Insert │  Database   │
└─────────────┘        │   + Worker   │        └─────────────┘
                       └──────────────┘              │
                              │                      │
                              │                      ▼
                       ┌──────────────┐        ┌─────────────┐
                       │  Prometheus  │◀───────│  Analysis   │
                       │   Metrics    │ Query  │   Engine    │
                       └──────────────┘        └─────────────┘
                              │                      │
                              ▼                      ▼
                       ┌──────────────┐        ┌─────────────┐
                       │   Grafana    │        │    JSON     │
                       │  Dashboard   │        │   Export    │
                       └──────────────┘        └─────────────┘
                                                      │
                                                      ▼
                                               ┌─────────────┐
                                               │ Interactive │
                                               │  Dashboard  │
                                               └─────────────┘

Data Flow:
1. Worker fetches USDC transfer events from Ethereum via JSON-RPC
2. Temporal orchestrates workflow with retry/resume capabilities
3. Events stored in ClickHouse with automatic deduplication
4. Analysis engine calculates gas metrics (MA7, daily totals, cumulative)
5. Prometheus scrapes worker metrics every 15s
6. Grafana visualizes real-time pipeline performance
7. Reports exported as JSON with interactive HTML dashboard
```

---

## Component Design

### 1. Blockchain Client Layer

**Technology**: viem (TypeScript Ethereum library)

**Responsibilities**:
- JSON-RPC communication with Ethereum nodes
- Event log fetching with topic filtering
- Transaction receipt retrieval for gas data
- Block timestamp resolution

**Key Design Decisions**:
- Singleton client pattern for connection reuse
- Separate queries for `from` and `to` filters (eth_getLogs limitation)
- Batch processing for transaction receipts to reduce RPC calls

### 2. Workflow Orchestration

**Technology**: Temporal

**Responsibilities**:
- Long-running process management
- Retry logic with configurable policies
- State persistence and resumability
- Progress monitoring via queries

**Key Design Decisions**:
- Clean separation between workflows and activities
- Heartbeats for long-running activities
- `continueAsNew` for large datasets (avoiding history limits)
- Graceful shutdown via signals

### 3. Data Storage

**Technology**: ClickHouse

**Responsibilities**:
- Time-series data storage
- Analytical query execution
- Data deduplication

**Schema Design**:
```sql
ENGINE = ReplacingMergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (block_timestamp, transaction_hash, log_index)
```

**Key Design Decisions**:
- `ReplacingMergeTree` for automatic deduplication (idempotency)
- Partitioning by month for efficient range queries
- Bloom filter indexes on addresses for fast filtering
- `UInt256` for precise wei values (no floating-point errors)

### 4. Analysis Engine

**Responsibilities**:
- Daily gas cost aggregation
- 7-day moving average calculation
- Cumulative metrics computation

**Key Design Decisions**:
- SQL window functions for efficient calculations
- Pre-aggregated views for common queries
- All calculations done in database (not in application code)

---

## Data Model

### Transfer Event Schema

| Field | Type | Description |
|-------|------|-------------|
| transaction_hash | String | Unique transaction identifier |
| log_index | UInt32 | Position within transaction logs |
| block_number | UInt64 | Ethereum block number |
| block_timestamp | DateTime | Block timestamp (UTC) |
| from_address | String | Sender address (lowercase) |
| to_address | String | Recipient address (lowercase) |
| value | UInt256 | Transfer amount in USDC base units |
| gas_used | UInt64 | Gas consumed by transaction |
| effective_gas_price | UInt256 | Actual gas price paid (wei) |
| gas_cost | UInt256 | Total cost: gas_used × effective_gas_price |
| event_date | Date | Derived date for partitioning |

### Deduplication Strategy

Events are uniquely identified by `(transaction_hash, log_index)`. ClickHouse's `ReplacingMergeTree` automatically handles duplicates during background merges, ensuring:
- Safe re-runs of the pipeline
- No manual deduplication logic required
- Consistent results across multiple executions

---

## Reliability Patterns

### 1. Retry with Exponential Backoff

```
delay = min(initial_delay × 2^attempt, max_delay) × random(0, 1)
```

Features:
- Full jitter to prevent thundering herd
- Configurable maximum attempts
- Retryable error classification (rate limits, network errors)

### 2. Rate Limit Handling

- **Balanced Mode Configuration**: 2000 blocks per batch, 150-200ms delays
- Batch processing with delays between requests
- Automatic retry on 429 responses with exponential backoff
- RPC-specific error detection (PublicNode, Infura, Alchemy)
- Adaptive rate limiting based on provider capabilities

### 3. Idempotency

- Database-level deduplication via ReplacingMergeTree
- Events keyed by (transaction_hash, log_index)
- No application-level deduplication required

### 4. Resumability

- Last processed block tracked in database
- Pipeline starts from last known position
- No data loss on interruption or restart

---

## Performance Considerations

### Block Range Optimization

- **Configurable batch size** (default: 2000 blocks for PublicNode)
- **Parallel processing** of `from` and `to` queries
- **Adaptive batching**:
  - Balanced mode: 2000 blocks (PublicNode, Infura)
  - Conservative mode: 1000 blocks (rate-limited scenarios)
  - Alchemy free tier: 10 blocks (strict limit)
- **Smart delays**: 150-200ms between batches to prevent rate limiting

### Database Optimization

- Columnar storage for efficient aggregations
- Partition pruning for date-range queries
- Bloom filters for address lookups
- Compression for storage efficiency

### Memory Management

- Stream processing of large result sets
- Batch inserts to reduce memory pressure
- Configurable batch sizes for different memory profiles

---

## Monitoring & Observability

### Prometheus Metrics

**Worker Monitoring:**

- **Live HTTP server** - metrics exposed via `/metrics` endpoint (port 9091)
- **Prometheus scraping** - continuous metrics collection every 15s
- **Grafana visualization** - pre-built dashboard with 8 panels
- **Use case**: Real-time workflow monitoring and performance analysis
- **Endpoints**:
  - `/metrics` - Prometheus scrape endpoint (port 9091)
  - `/health` - Health check JSON response (port 9091)
  - Prometheus UI - http://localhost:9092
  - Grafana dashboard - http://localhost:3000

**Tracked Metrics:**
- **RPC Latency**: Histogram of request durations by method (eth_getLogs, eth_getBlockByNumber, etc.)
- **Rate Limit Hits**: Counter for rate limit errors with provider labels
- **Retry Attempts**: Counter with reason classification (rate_limit, network_error, etc.)
- **Progress Tracking**:
  - Events collected counter
  - Blocks processed counter
  - Pipeline progress gauge (0-1)
  - Current block number gauge
- **Database Operations**: Counters and latency histograms
- **System Metrics**: Default Node.js metrics (CPU, memory, event loop lag)

### Temporal UI
- Workflow execution status
- Activity progress via heartbeats
- Query support for progress monitoring

### Logging
- Structured JSON logging (pino)
- Component-based log namespacing
- Configurable log levels

### Health Checks
- ClickHouse ping endpoint
- RPC connectivity validation
- Database schema verification
- Combined health endpoint for Prometheus monitoring

---

## Deployment Options

### 1. Docker Compose (Recommended)
- Full stack deployment
- Includes ClickHouse, Temporal, Prometheus, Grafana
- Pre-configured monitoring and dashboards
- Suitable for development, testing, and small-scale production

### 2. Production Deployment
- Kubernetes-ready containers
- Horizontal scaling via worker replicas
- External ClickHouse cluster support
- Prometheus/Grafana for observability

---

## Security Considerations

- No sensitive data stored (only public transaction metadata)
- RPC URL configured via environment variables
- **PublicNode**: No API keys required (public endpoint)
- **Alternative providers**: API keys stored in `.env` (git-ignored)
- Non-root container execution
- Network isolation via Docker networks

---

## Performance Results

**Current Setup (PublicNode + Balanced Mode):**
- **Collection Speed**: 7,108 events in ~8 minutes
- **Batch Size**: 2000 blocks
- **Success Rate**: 100% (no rate limit failures)
- **Block Range**: 23,817,616 → 23,865,589 (48,024 blocks scanned)
- **Time Period**: November 17-24, 2025 (8 days of recent data)

**Mode Comparison:**
| Mode | Batch Size | Delays | Speed | Risk |
|------|------------|--------|-------|------|
| Conservative | 500 | 500ms | Slow (~25 hours) | Very Low |
| Balanced | 2000 | 150-200ms | Fast (~3 mins) | Low |
| Aggressive | 5000 | 100ms | Failed | High |

---

## Visualization & Deliverables

### Analysis Report Export

**Command:**
```bash
docker compose run --rm starter node dist/commands/export-report.js
```

**Output Location:** `./output/analysis_report.json`

**Contents:**
- Summary statistics (events collected, block range, time period)
- Daily gas cost in ETH and wei
- 7-day moving average of effective gas price (Gwei)
- Cumulative gas cost over time

### Interactive Dashboard

**File:** `./output/dashboard.html`

**Features:**
- Self-contained HTML with embedded Chart.js
- 3 interactive visualizations:
  - Daily Gas Cost (bar chart)
  - 7-Day Moving Average Gas Price (line chart)
  - Cumulative Gas Cost (area chart)
- Summary cards with key metrics
- Professional responsive design
- Works offline once loaded

**Usage:**
Open `./output/dashboard.html` in any web browser to view the visualizations.

**Data Source:**
Dashboard automatically loads data from `analysis_report.json` in the same directory.

---

## Future Enhancements

1. **ETH/USDC Conversion**: Integration with price feed APIs (e.g., CoinGecko) for USD-denominated costs
2. **Real-time Processing**: WebSocket subscription for new events as they occur
3. **Multi-chain Support**: Abstract chain-specific logic for Polygon, Arbitrum, and other EVM chains
4. **RPC Load Balancing**: Rotate between multiple public endpoints for better reliability and failover
5. **Advanced Alerting**: Prometheus AlertManager rules for rate limits, failures, and latency spikes
6. **Historical Backfill**: Automated backfill workflows for missing historical data
