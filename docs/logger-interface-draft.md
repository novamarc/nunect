# Logger Interface Specification (Draft)

**Purpose:** Generic logging appliance - transport agnostic

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    APPLICATION (Nuxt/Any)                    │
│                         │                                    │
│                         ▼                                    │
│              ┌─────────────────────┐                        │
│              │   Logger Client     │                        │
│              │   (interface)       │                        │
│              └──────────┬──────────┘                        │
│                         │                                    │
│            ┌────────────┼────────────┐                      │
│            │            │            │                      │
│            ▼            ▼            ▼                      │
│      ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│      │  File   │  │  NATS   │  │ Console │                 │
│      │ Backend │  │ Backend │  │ Backend │                 │
│      │ (now)   │  │ (later) │  │ (debug) │                 │
│      └─────────┘  └─────────┘  └─────────┘                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Interface Definition

### TypeScript

```typescript
// Logger levels
enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

// Log entry structure
interface LogEntry {
  ts: string;           // ISO 8601 timestamp
  lvl: LogLevel;        // Level
  unit: string;         // Unit ID (who)
  comp: string;         // Component (what)
  msg: string;          // Message
  fields?: Record<string, any>;  // Structured data
  trace?: string;       // Trace/correlation ID
}

// Logger backend interface
interface LoggerBackend {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  log(entry: LogEntry): Promise<void>;
  query(filter: LogQuery): Promise<LogEntry[]>;
}

// Query interface
interface LogQuery {
  start?: Date;
  end?: Date;
  level?: LogLevel;
  unit?: string;
  comp?: string;
  trace?: string;
  limit?: number;
}

// Main logger class
class Logger {
  constructor(unitId: string, backends: LoggerBackend[]);
  
  // Standard logging
  debug(msg: string, fields?: object): void;
  info(msg: string, fields?: object): void;
  warn(msg: string, fields?: object): void;
  error(msg: string, fields?: object): void;
  fatal(msg: string, fields?: object): void;
  
  // With component context
  withComponent(comp: string): Logger;
  
  // With trace ID
  withTrace(traceId: string): Logger;
  
  // Query (delegates to first backend that supports query)
  query(filter: LogQuery): Promise<LogEntry[]>;
}
```

### Go

```go
type LogLevel string

const (
    DEBUG LogLevel = "debug"
    INFO  LogLevel = "info"
    WARN  LogLevel = "warn"
    ERROR LogLevel = "error"
    FATAL LogLevel = "fatal"
)

type LogEntry struct {
    TS     string                 `json:"ts"`
    Lvl    LogLevel               `json:"lvl"`
    Unit   string                 `json:"unit"`
    Comp   string                 `json:"comp"`
    Msg    string                 `json:"msg"`
    Fields map[string]interface{} `json:"fields,omitempty"`
    Trace  string                 `json:"trace,omitempty"`
}

type LoggerBackend interface {
    Name() string
    Connect(ctx context.Context) error
    Disconnect() error
    Log(ctx context.Context, entry LogEntry) error
}

type Logger interface {
    Debug(msg string, fields ...Field)
    Info(msg string, fields ...Field)
    Warn(msg string, fields ...Field)
    Error(msg string, fields ...Field)
    Fatal(msg string, fields ...Field)
    WithComponent(comp string) Logger
    WithTrace(traceId string) Logger
}
```

---

## File Backend (Immediate Implementation)

### Configuration
```yaml
logging:
  level: info
  backends:
    - type: file
      config:
        path: ./logs
        rotation: daily
        max_size: 100MB
        max_files: 30
        format: jsonl  # jsonl or pretty
```

### Output Format (JSONL)
```jsonl
{"ts":"2024-01-15T14:30:00.123Z","lvl":"info","unit":"nuxt-app-01","comp":"auth","msg":"User login","fields":{"user_id":"123","provider":"better-auth"}}
{"ts":"2024-01-15T14:30:05.456Z","lvl":"warn","unit":"nuxt-app-01","comp":"api","msg":"Slow response","fields":{"duration_ms":2500,"route":"/api/users"}}
```

### File Structure
```
logs/
├── app-2024-01-15.jsonl
├── app-2024-01-14.jsonl
└── app-current.jsonl -> app-2024-01-15.jsonl
```

---

## NATS Backend (Future Implementation)

### Subjects
```
ops.log.debug.{unitID}
ops.log.info.{unitID}
ops.log.warn.{unitID}
ops.log.error.{unitID}
ops.log.fatal.{unitID}
```

### Headers (AT-style)
```
uid: nuxt-app-01
lvl: info
tst: 1705330200123000000
trc: req-abc-123
```

### Payload (same JSON as file)
```json
{
  "comp": "auth",
  "msg": "User login",
  "fields": {"user_id": "123"}
}
```

---

## Appliance Script

```bash
#!/bin/bash
# logger-appliance.sh

# Starts a logger appliance that:
# 1. Reads logs from file or NATS
# 2. Provides query interface
# 3. Forwards to other backends

./logger-appliance \
  --source file://./logs \
  --output nats://nats.nunet.one:4222 \
  --filter "lvl>=warn" \
  --buffer 1000
```

---

## Development Phases

### Phase 1: File Backend (Now)
- [ ] TypeScript logger client
- [ ] File backend implementation
- [ ] Component context (withComponent)
- [ ] Trace correlation
- [ ] Query interface (file read)

### Phase 2: NATS Backend (Later)
- [ ] NATS backend implementation
- [ ] JetStream persistence option
- [ ] Subscribe/query from NATS

### Phase 3: Appliance
- [ ] Standalone logger service
- [ ] Multi-backend forwarding
- [ ] Filtering/buffering

---

**You work on:** Protocol docs review, tweaks, presentation
**I work on:** Nuxt base with Better Auth, Cloudflare Workers, integrating this logger interface

When you're ready with protocol feedback, we align the docs and implement the real clients.
