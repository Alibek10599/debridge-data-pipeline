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
  │ (Alchemy)│   Events     │   Engine     │  Insert  │   Series)   │
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

- Batch processing with configurable size
- Delays between batches
- Automatic retry on 429 responses
- Adaptive backoff based on error frequency

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

- Configurable batch size (default: 2000 blocks)
- Parallel processing of `from` and `to` queries
- Adaptive ranges based on event density

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

- No sensitive data stored (only transaction metadata)
- RPC URL passed via environment variables
- Non-root container execution
- Network isolation via Docker networks

---

## Future Enhancements

1. **Prometheus Metrics**: Export RPC latency, retry counts, throughput
2. **ETH/USDC Conversion**: Integration with price feed APIs
3. **Real-time Processing**: WebSocket subscription for new events
4. **Multi-chain Support**: Abstract chain-specific logic for other networks
