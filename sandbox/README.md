# DaShengOS Go Sandbox · v0.3 Phase 3 + 4

17 IPC methods + 5 sub-agents over Unix socket (JSON-RPC 2.0, NDJSON framing)
+ supervisord (process supervision with hot restart)
+ Prometheus metrics + Grafana dashboard
+ Multi-stage distroless Dockerfile + docker-compose + K8s manifests.

## v0.3 spec mapping

| Spec §  | Methods | Notes |
|---------|---------|-------|
| §15.1   | `health.ping` | daemon health + version + method count |
| §15.2   | `sandbox.exec` | namespace+seccomp+cgroup (Linux) / process (macOS dev) |
| §15.2   | `research.run` `status` `result` `cancel` `stream` | 5 methods, in-memory job store |
| §15.4   | `file.read` `file.write` | allowlisted paths, 16MB cap |
| §15.5   | `agent.list` `agent.run` | 6 default agents, in-memory jobs |
| §15.6   | `skill.list` `skill.load` | loads from `~/.dasheng/skills/<id>/SKILL.md` |
| §15.7   | `audit.write` | HMAC-SHA256, appends to `~/.dasheng/audit.log` |
| §15.8   | `secret.read` | env → macOS Keychain / Linux `pass` → file |
| §15.9   | `browser.navigate` `browser.extract` | playwright CLI / mock |
| §17     | `subagent.research` `run_agent` `apply_skill` `exec_safe` `file_op` | 5 sub-agents per spec §17 |
| §15.11  | `metrics.snapshot` | Prometheus text + JSON |
| §15.11  | **supervisord** (separate binary) | hot restart, exp backoff, log aggregation |

## Architecture (Phase 3 + 4)

```
                ┌─────────────────┐
                │  packages/      │  TypeScript backend (Fastify)
                │    backend      │  ──── calls via SocketClient
                └────────┬────────┘
                         │  /tmp/dasheng/sandbox.sock (canonical)
                         │  JSON-RPC 2.0 + NDJSON
                         ▼
┌────────────────────────────────────────┐
│  supervisord (cmd/supervisord)         │  ← Phase 3 T3.4
│  ├─ control: /tmp/dasheng/sandbox.sock │
│  └─ workers: /tmp/dasheng/sandbox-N.sock
│       ↓ manages
│  ┌─────────────────────────────────┐  │
│  │  sandbox daemon (cmd/sandbox)   │  │
│  │  ├─ internal/ipc/               │  │
│  │  ├─ internal/security/          │  │
│  │  └─ internal/handlers/  (22 ipc)│  │
│  └─────────────────────────────────┘  │
│       ↓ (on crash) auto-restart
│         with exp backoff
└────────────────────────────────────────┘
```

## Platform isolation matrix

| OS          | namespace | seccomp | cgroup v2 | Status      |
|-------------|-----------|---------|-----------|-------------|
| Linux       | ✅ (CLONE_NEWNS + CLONE_NEWPID + CLONE_NEWUSER) | ✅ PR_SET_NO_NEW_PRIVS (full BPF in Phase 4) | ✅ memory.max + cpu.max + pids.max | production-grade |
| macOS       | ❌        | ❌      | ❌        | dev fallback + warning log |
| Windows     | ❌        | ❌      | ❌        | not supported |

## Build & Run

```bash
# Build both binaries
make build                                # → bin/sandbox + bin/supervisord

# Run sandbox directly
DASHE_SANDBOX_SOCKET=/tmp/dasheng/sandbox.sock ./bin/sandbox

# Run via supervisord (production-style: hot restart + health)
make supervisord
# or: ./bin/supervisord -bin ./bin/sandbox -workers 1 -health-period 5s
```

## 3-Layer Testing

```bash
# Layer 1: Go unit tests (10+ test cases for sub-agents, file ops, etc.)
make test-unit

# Layer 2: Python E2E (49 checks across 23 test groups)
make test

# Layer 3: docker-compose stack E2E (sandbox + supervisord + prom + grafana)
make docker-up
sleep 5
curl http://127.0.0.1:9090  # Prometheus
open http://127.0.0.1:3001 # Grafana (admin / admin)
make docker-down

# All 3 layers
make test-all
```

## Phase 4 deployment

### Docker (single-host)

```bash
make docker-build
make docker-up
# Grafana: http://127.0.0.1:3001 (admin/admin)
# Prom:    http://127.0.0.1:9090
```

### Kubernetes

```bash
# Edit image tag in deploy/k8s/sandbox-deployment.yaml if needed
make k8s-apply
kubectl -n dasheng get pods
kubectl -n dasheng logs -f deploy/sandbox
```

The k8s manifests include:
- Namespace + ConfigMap
- Deployment with 2 replicas, rolling update, securityContext
- Headless Service for DNS discovery
- ServiceMonitor (for Prometheus Operator)
- PodDisruptionBudget (≥1 always up)

## Wire protocol

NDJSON over Unix socket, JSON-RPC 2.0:

```json
// request
{"jsonrpc":"2.0","id":1,"method":"sandbox.exec","params":{"command":"node","args":["--version"]}}

// response
{"jsonrpc":"2.0","id":1,"result":{"exit_code":0,"stdout":"v23.11.1\n","stderr":"","duration_ms":87,"isolated":false}}

// error
{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found: does.not.exist"}}
```

## IPC methods (23 total)

### Core (§15)

| Method | Params | Result |
|--------|--------|--------|
| `health.ping` | `{}` | `{status,version,go,os,arch,methods}` |
| `sandbox.exec` | `{command,args,workdir,env,input,timeout_ms,memory_mb,cpu_percent}` | `{exit_code,stdout,stderr,duration_ms,timed_out,isolated}` |
| `file.read` | `{path,encoding?}` | `{path,content,size,mtime}` |
| `file.write` | `{path,content,encoding?,create_dirs?}` | `{path,bytes_written,mtime}` |
| `research.run` | `{query,max_results?}` | `{id,status}` |
| `research.status` | `{id}` | `{id,status,progress,error?}` |
| `research.result` | `{id}` | `{id,query,status,findings,error?}` |
| `research.cancel` | `{id}` | `{id,cancelled}` |
| `research.stream` | `{id,since?}` | `{id,events,status}` |
| `agent.list` | `{}` | `{agents:[…]}` |
| `agent.run` | `{agent_id,input}` | `{id,status}` |
| `skill.list` | `{category?}` | `{skills:[…]}` |
| `skill.load` | `{id}` | `{id,name,description,category,tags,manifest,body}` |
| `audit.write` | `{action,actor?,target?,metadata?}` | `{id,timestamp,hmac}` |
| `secret.read` | `{name}` | `{name,value,source}` |
| `browser.navigate` | `{url,timeout_ms?}` | `{status,title,final_url}` |
| `browser.extract` | `{url,selector?,timeout_ms?}` | `{text,html,links}` |

### 5 Sub-agents (§17)

| Method | Purpose |
|--------|---------|
| `subagent.research` | multi-step deep research with citation |
| `subagent.run_agent` | orchestrator: run agent, chain with others |
| `subagent.apply_skill` | load skill + execute its commands |
| `subagent.exec_safe` | policy-wrapped sandbox.exec (default/read-only/no-network) |
| `subagent.file_op` | atomic file ops: read/write/move/copy/delete/list/search |

### Operations (§15.11)

| Method | Purpose |
|--------|---------|
| `metrics.snapshot` | Prometheus text + JSON metrics |

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `DASHE_SANDBOX_SOCKET` | `/tmp/dasheng/sandbox.sock` | sandbox daemon socket |
| `DASHE_CONTROL_SOCKET` | `/tmp/dasheng/sandbox.sock` | supervisord control socket |
| `DASHE_BROWSER_MOCK` | (unset) | If `1`, skip real playwright |
| `DASHE_SKILLS_ROOT` | `~/.dasheng/skills` | Skill directory |
| `DASHE_AUDIT_KEY` | `dev-key-CHANGE-IN-PROD` | HMAC key for audit |
| `DASHE_SANDBOX_READ_ROOTS` | `$HOME/Library, /tmp/dasheng, /usr, /opt, /var/log` | file.read allowlist |
| `DASHE_SANDBOX_WRITE_ROOTS` | `$HOME/Library, /tmp/dasheng` | file.write allowlist |
| `DASHE_SECRET_*` | (none) | env-based secrets (e.g. `DASHE_SECRET_TEST_TOKEN=xxx`) |

## Files

```
sandbox/
├── Makefile                # build / run / test / docker / k8s
├── README.md
├── go.mod
├── cmd/
│   ├── sandbox/main.go     # JSON-RPC daemon (17 IPC + 5 sub-agents + 1 metrics)
│   └── supervisord/main.go # process supervisor
├── internal/
│   ├── ipc/                # JSON-RPC + Unix socket
│   ├── security/           # Linux namespace+seccomp+cgroup + macOS fallback
│   └── handlers/           # 22 IPC handlers + 10+ Go unit tests
├── deploy/
│   ├── Dockerfile          # multi-stage distroless
│   ├── docker-compose.yml  # sandbox + supervisord + prometheus + grafana
│   ├── k8s/                # namespace + deployment + service + serviceMonitor + PDB
│   └── monitoring/         # prometheus.yml + grafana-dashboard.json + provisioning
├── test_e2e.py             # Python integration test (49 checks)
└── test-sandbox-socket.ts  # (separate, in ../runtime/src/) TS integration test
```

## License

Internal — DaShengOS
