# Architecture Overview

## System Design

This document describes the key architectural decisions for the deBridge USDC Transfer Events data pipeline.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Data Flow                                   │
└─────────────────────────────────────────────────────────────────────────┘

  Ethereum Mainnet          Processing Layer           Storage Layer
  ────────────────          ────────────────           ─────────────
        │                          │                         │
        │    eth_getLogs           │                         │
        │  ◄─────────────────────  │                         │
        │                          │                         │
        ▼                          ▼                         ▼
  ┌──────────┐              ┌──────────────┐          ┌──────────────┐
  │   RPC    │─────────────▶│   Temporal   │─────────▶│  ClickHouse  │
  │ Provider │  Transfer    │   Workflow   │  Batch   │   (Time-    │
  │(PublicNode)│  Events    │   Engine     │  Insert  │   Series)   │
  └──────────┘              └──────────────┘          └──────────────┘
        │                          │                         │
        │  eth_getTransactionReceipt                         │
        │  ◄───────────────────────│                         │
        │                          │                         │
        ▼                          ▼                         ▼
  ┌──────────┐              ┌──────────────┐          ┌──────────────┐
  │   Gas    │─────────────▶│  Enrichment  │         │   Analysis   │
  │   Data   │              │   Activity   │         │   Queries    │
  └──────────┘              └──────────────┘          └──────────────┘
                                   │                         │
                                   ▼                         ▼
                           ┌──────────────┐          ┌──────────────┐
                           │    JSON      │◀─────────│   Metrics    │
                           │   Export     │          │  Calculator  │
                           └──────────────┘          └──────────────┘
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

**Two Monitoring Modes:**

#### 1. Standalone Pipeline (Batch Mode)
- **No live HTTP server** - metrics collected in memory
- **Summary display** - metrics logged to console at completion
- **File export** - metrics saved to `output/metrics.json`
- **Use case**: Short-lived data collection (~3 minutes)
- **Output format**: Human-readable summary + Prometheus text format

#### 2. Temporal Worker (Service Mode)
- **Live HTTP server** - metrics exposed via `/metrics` endpoint (port 9091)
- **Prometheus scraping** - continuous metrics collection
- **Use case**: Long-running workflow processing
- **Endpoints**:
  - `/metrics` - Prometheus scrape endpoint
  - `/health` - Health check JSON response

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
- Includes ClickHouse, Temporal, workers
- Suitable for development and testing

### 2. Standalone Mode
- Runs without Temporal
- Simpler setup for local testing
- Direct pipeline execution

### 3. Production Deployment
- Kubernetes-ready containers
- Horizontal scaling via worker replicas
- External ClickHouse cluster support

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
- **Collection Speed**: 5,072 events in ~3 minutes
- **Batch Size**: 2000 blocks
- **Success Rate**: 100% (no rate limit failures)
- **Block Range**: 18,000,000 → 18,581,888 (581,888 blocks scanned)
- **Time Period**: August 2023 → January 2024 (4+ months)

**Mode Comparison:**
| Mode | Batch Size | Delays | Speed | Risk |
|------|------------|--------|-------|------|
| Conservative | 500 | 500ms | Slow (~25 hours) | Very Low |
| Balanced | 2000 | 150-200ms | Fast (~3 mins) | Low |
| Aggressive | 5000 | 100ms | Failed | High |

## Future Enhancements

1. **ETH/USDC Conversion**: Integration with price feed APIs (e.g., CoinGecko)
2. **Real-time Processing**: WebSocket subscription for new events
3. **Multi-chain Support**: Abstract chain-specific logic for other networks
4. **RPC Load Balancing**: Rotate between multiple public endpoints for better reliability
5. **Grafana Dashboards**: Pre-built visualization dashboards for Prometheus metrics
6. **Alerting**: Prometheus AlertManager rules for rate limits, failures, and latency spikes
