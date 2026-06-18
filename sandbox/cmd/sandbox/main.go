// cmd/sandbox/main.go · v0.3 spec §15 · DaShengOS sandbox daemon
//
// 16 IPC methods over Unix socket (JSON-RPC 2.0, NDJSON framing).
// Mirrors the Python DeerFlow daemon (deerflow/daemon.py) but written
// in Go for low-overhead process isolation (namespace+seccomp+cgroup).
package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/dashengos/sandbox/internal/handlers"
	"github.com/dashengos/sandbox/internal/ipc"
	"github.com/dashengos/sandbox/internal/security"
)

func main() {
	logger := log.New(os.Stderr, "[sandbox] ", log.LstdFlags|log.Lmicroseconds)
	logger.Printf("starting DaShengOS sandbox daemon %s", handlers.SandboxVersion)
	security.WarnIfNotLinux()

	// Build the method registry
	reg := ipc.NewRegistry()

	// Stores (Phase 3 in-memory; Phase 4 can back with SQLite)
	research := handlers.NewResearchStore()
	agents := handlers.NewAgentStore()
	skills := handlers.NewSkillStore()
	audit := handlers.NewAuditStore()

	// Register all 16 methods (matches the v0.3 spec §15 IPC list)
	// Core / utility
	reg.Register("health.ping", handlers.HealthPing(0)) // count patched below
	reg.Register("sandbox.exec", handlers.Exec)
	// File ops (§15.4)
	reg.Register("file.read", handlers.FileRead)
	reg.Register("file.write", handlers.FileWrite)
	// Research workflow (§15.2)
	reg.Register("research.run", handlers.ResearchRun(research))
	reg.Register("research.status", handlers.ResearchStatus(research))
	reg.Register("research.result", handlers.ResearchResult(research))
	reg.Register("research.cancel", handlers.ResearchCancel(research))
	reg.Register("research.stream", handlers.ResearchStream(research))
	// Agent registry (§15.5)
	reg.Register("agent.list", handlers.AgentList(agents))
	reg.Register("agent.run", handlers.AgentRun(agents))
	// Skills (§15.6)
	reg.Register("skill.list", handlers.SkillList(skills))
	reg.Register("skill.load", handlers.SkillLoad(skills))
	// Audit (§15.7)
	reg.Register("audit.write", handlers.AuditWrite(audit))
	// Secrets (§15.8)
	reg.Register("secret.read", handlers.SecretRead)
	// Browser (§15.9)
	reg.Register("browser.navigate", handlers.BrowserNavigate)
	reg.Register("browser.extract", handlers.BrowserExtract)

	// 5 sub-agents per spec §17 (Phase 3 T3.5)
	reg.Register("subagent.research", handlers.SubagentResearch)
	reg.Register("subagent.run_agent", handlers.SubagentRunAgent)
	reg.Register("subagent.apply_skill", handlers.SubagentApplySkill)
	reg.Register("subagent.exec_safe", handlers.SubagentExecSafe)
	reg.Register("subagent.file_op", handlers.SubagentFileOp)

	// Metrics (Phase 4 — Prometheus exposition)
	reg.Register("metrics.snapshot", handlers.MetricsSnapshotHandler)

	// Now we know the real method count — re-register health.ping with it
	reg.Register("health.ping", handlers.HealthPing(len(reg.Methods())))

	socketPath := os.Getenv("DASHE_SANDBOX_SOCKET")
	if socketPath == "" {
		socketPath = "/tmp/dasheng/sandbox.sock"
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o755); err != nil {
		logger.Fatalf("mkdir socket dir: %v", err)
	}

	srv := ipc.NewServer(reg, ipc.Options{
		SocketPath: socketPath,
		Workers:    8,
		Logger:     logger,
	})

	// Graceful shutdown on SIGINT / SIGTERM
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		logger.Printf("shutdown signal received")
		srv.Shutdown()
	}()

	logger.Printf("registered %d methods: %v", len(reg.Methods()), reg.Methods())
	if err := srv.Listen(); err != nil {
		logger.Fatalf("server error: %v", err)
	}
	logger.Printf("sandbox daemon exited cleanly")
}
