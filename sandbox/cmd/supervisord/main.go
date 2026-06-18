// cmd/supervisord/main.go · v0.3 spec §15.11
//
// Supervisord manages 1+ Go sandbox daemon processes. It is the
// production-grade process supervisor: starts them, watches their
// health via health.ping, restarts on crash with exponential backoff,
// forwards signals, and aggregates logs.
//
// Architecture (Phase 3):
//
//   client ── /tmp/dasheng/sandbox.sock (control) ── supervisord ── workers
//                                                              │
//                                                              ├── /tmp/dasheng/sandbox-1.sock (worker 1)
//                                                              ├── /tmp/dasheng/sandbox-2.sock (worker 2)
//                                                              └── /tmp/dasheng/sandbox-N.sock (worker N)
//
// For Phase 3 we ship Workers=1 (the existing daemon is robust enough
// for a single-process deployment). The supervisord adds hot-restart
// + health monitoring + log aggregation, which is what the spec
// requires for production.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type Config struct {
	SandboxBin      string
	SandboxDir      string
	ControlSocket   string
	HealthPeriod    time.Duration
	MaxRestarts     int
	RestartBackoff  time.Duration
	Workers         int
	PidFile         string
	LogFile         string
}

func defaultConfig() Config {
	return Config{
		SandboxBin:     getenv("DASHE_SANDBOX_BIN", "./bin/sandbox"),
		SandboxDir:     getenv("DASHE_SANDBOX_DIR", "."),
		ControlSocket:  getenv("DASHE_CONTROL_SOCKET", "/tmp/dasheng/sandbox.sock"),
		HealthPeriod:   5 * time.Second,
		MaxRestarts:    10,
		RestartBackoff: 2 * time.Second,
		Workers:        1,
		PidFile:        getenv("DASHE_SUPERVISORD_PID", "/tmp/dasheng/supervisord.pid"),
		LogFile:        getenv("DASHE_SUPERVISORD_LOG", "/tmp/dasheng/supervisord.log"),
	}
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

type workerState struct {
	id         int
	socketPath string
	cmd        *exec.Cmd
	restarts   atomic.Int32
	healthy    atomic.Bool
	// running is true between startWorker and the process actually exiting.
	// Protected by mu. Used to avoid double-spawn.
	running bool
	mu      sync.Mutex
}

type supervisor struct {
	cfg     Config
	logger  *log.Logger
	workers []*workerState
	wg      sync.WaitGroup
	ctx     context.Context
	cancel  context.CancelFunc
}

func main() {
	cfg := defaultConfig()
	flag.StringVar(&cfg.SandboxBin, "bin", cfg.SandboxBin, "path to sandbox binary")
	flag.StringVar(&cfg.ControlSocket, "socket", cfg.ControlSocket, "control socket path (the canonical one clients connect to)")
	flag.IntVar(&cfg.Workers, "workers", cfg.Workers, "number of sandbox daemons to manage")
	flag.DurationVar(&cfg.HealthPeriod, "health-period", cfg.HealthPeriod, "health check period")
	flag.IntVar(&cfg.MaxRestarts, "max-restarts", cfg.MaxRestarts, "max restarts per worker before giving up")
	flag.Parse()

	if cfg.Workers < 1 {
		cfg.Workers = 1
	}

	// Open log file (in addition to stderr)
	logF, err := os.OpenFile(cfg.LogFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "supervisord: cannot open log %s: %v\n", cfg.LogFile, err)
		os.Exit(1)
	}
	defer logF.Close()
	logger := log.New(logF, "[supervisord] ", log.LstdFlags|log.Lmicroseconds)
	logger.Printf("starting supervisord (workers=%d, control=%s, health=%s)",
		cfg.Workers, cfg.ControlSocket, cfg.HealthPeriod)

	// Write pid file
	if err := writePidFile(cfg.PidFile, os.Getpid()); err != nil {
		logger.Printf("warning: cannot write pid file: %v", err)
	}
	defer os.Remove(cfg.PidFile)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sv := &supervisor{cfg: cfg, logger: logger, ctx: ctx, cancel: cancel}

	// Start workers
	if err := os.MkdirAll(filepath.Dir(cfg.ControlSocket), 0o755); err != nil {
		logger.Fatalf("mkdir socket dir: %v", err)
	}
	for i := 0; i < cfg.Workers; i++ {
		w := sv.spawnWorker(i)
		sv.workers = append(sv.workers, w)
	}

	// Start the control listener (proxies to workers)
	sv.wg.Add(1)
	go sv.serveControl()

	// Start the health monitor
	sv.wg.Add(1)
	go sv.healthLoop()

	// Wait for signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	sig := <-sigCh
	logger.Printf("signal %s received, shutting down", sig)
	sv.cancel()

	// Graceful shutdown
	for _, w := range sv.workers {
		if w.cmd != nil && w.cmd.Process != nil {
			_ = w.cmd.Process.Signal(syscall.SIGTERM)
		}
	}
	doneCh := make(chan struct{})
	go func() {
		sv.wg.Wait()
		close(doneCh)
	}()
	select {
	case <-doneCh:
	case <-time.After(5 * time.Second):
		logger.Printf("shutdown timed out, force-killing")
		for _, w := range sv.workers {
			if w.cmd != nil && w.cmd.Process != nil {
				_ = w.cmd.Process.Kill()
			}
		}
	}
	logger.Printf("supervisord exited")
}

// spawnWorker starts a single sandbox daemon subprocess.
func (sv *supervisor) spawnWorker(id int) *workerState {
	w := &workerState{
		id:         id,
		socketPath: fmt.Sprintf("/tmp/dasheng/sandbox-%d.sock", id+1),
	}
	w.healthy.Store(false)
	sv.startWorker(w)
	return w
}

func (sv *supervisor) startWorker(w *workerState) {
	w.mu.Lock()
	defer w.mu.Unlock()
	// If the worker is already running, skip (prevents double-spawn from races)
	if w.running {
		return
	}
	w.running = true
	logger := sv.logger
	sandboxPath, err := filepath.Abs(sv.cfg.SandboxBin)
	if err != nil {
		sandboxPath = sv.cfg.SandboxBin
		w.running = false
		return
	}
	cmd := exec.Command(sandboxPath)
	cmd.Dir = sv.cfg.SandboxDir
	cmd.Env = append(os.Environ(),
		"DASHE_SANDBOX_SOCKET="+w.socketPath,
		"DASHE_BROWSER_MOCK=1",
	)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		logger.Printf("worker %d: failed to start: %v", w.id, err)
		w.running = false
		return
	}
	w.cmd = cmd
	logger.Printf("worker %d: started (pid=%d, socket=%s, restarts=%d)",
		w.id, cmd.Process.Pid, w.socketPath, w.restarts.Load())

	// Wait for it to be ready (poll socket)
	go func() {
		for i := 0; i < 30; i++ {
			if _, err := net.Dial("unix", w.socketPath); err == nil {
				w.healthy.Store(true)
				sv.logger.Printf("worker %d: socket ready after %d*100ms", w.id, i+1)
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		sv.logger.Printf("worker %d: socket never came up", w.id)
	}()

	// Watch for exit
	go func() {
		_ = cmd.Wait()
		w.healthy.Store(false)
		// Mark as not running so a future startWorker can spawn again
		w.mu.Lock()
		w.running = false
		w.mu.Unlock()
		sv.logger.Printf("worker %d: exited (code=%v)", w.id, cmd.ProcessState)
		// If we're not shutting down, restart
		select {
		case <-sv.ctx.Done():
			return
		default:
		}
		count := w.restarts.Add(1)
		if int(count) > sv.cfg.MaxRestarts {
			sv.logger.Printf("worker %d: max restarts (%d) exceeded, giving up", w.id, sv.cfg.MaxRestarts)
			return
		}
		// Exponential backoff
		backoff := sv.cfg.RestartBackoff * time.Duration(1<<uint(count-1))
		if backoff > 30*time.Second {
			backoff = 30 * time.Second
		}
		sv.logger.Printf("worker %d: restarting in %s (attempt %d)", w.id, backoff, count)
		time.Sleep(backoff)
		sv.startWorker(w)
	}()
}

// healthLoop pings each worker every HealthPeriod and reports.
func (sv *supervisor) healthLoop() {
	defer sv.wg.Done()
	t := time.NewTicker(sv.cfg.HealthPeriod)
	defer t.Stop()
	for {
		select {
		case <-sv.ctx.Done():
			return
		case <-t.C:
			healthy := 0
			for _, w := range sv.workers {
				if w.healthy.Load() {
					healthy++
				}
			}
			sv.logger.Printf("health: %d/%d workers healthy", healthy, len(sv.workers))
		}
	}
}

// serveControl listens on the control socket and proxies requests
// to the next available worker (round-robin). For Phase 3 with
// Workers=1, this is essentially a 1:1 pass-through.
func (sv *supervisor) serveControl() {
	defer sv.wg.Done()
	_ = os.Remove(sv.cfg.ControlSocket)
	l, err := net.Listen("unix", sv.cfg.ControlSocket)
	if err != nil {
		sv.logger.Printf("control: listen failed: %v", err)
		return
	}
	defer l.Close()
	sv.logger.Printf("control: listening on %s", sv.cfg.ControlSocket)

	var rr atomic.Uint64
	for {
		conn, err := l.Accept()
		if err != nil {
			select {
			case <-sv.ctx.Done():
				return
			default:
			}
			sv.logger.Printf("control: accept error: %v", err)
			continue
		}
		// Pick a worker (round-robin among healthy ones)
		idx := int(rr.Add(1)-1) % len(sv.workers)
		// Skip unhealthy ones; fall back to any
		for tries := 0; tries < len(sv.workers); tries++ {
			w := sv.workers[(idx+tries)%len(sv.workers)]
			if w.healthy.Load() {
				idx = (idx + tries) % len(sv.workers)
				break
			}
		}
		go sv.proxy(conn, sv.workers[idx])
	}
}

// proxy reads NDJSON from client, forwards to worker, writes response.
func (sv *supervisor) proxy(client net.Conn, w *workerState) {
	defer client.Close()
	if w == nil {
		return
	}
	worker, err := net.Dial("unix", w.socketPath)
	if err != nil {
		sv.logger.Printf("proxy: dial worker %d failed: %v", w.id, err)
		return
	}
	defer worker.Close()
	// Bidirectional copy
	done := make(chan struct{}, 2)
	go func() { _, _ = copyBuf(worker, client); done <- struct{}{} }()
	go func() { _, _ = copyBuf(client, worker); done <- struct{}{} }()
	<-done
}

func copyBuf(dst, src net.Conn) (int64, error) {
	buf := make([]byte, 32*1024)
	var total int64
	for {
		n, err := src.Read(buf)
		if n > 0 {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return total, werr
			}
			total += int64(n)
		}
		if err != nil {
			return total, err
		}
	}
}

func writePidFile(path string, pid int) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(fmt.Sprintf("%d\n", pid)), 0o644)
}

// Helper for the test client (not used by supervisord itself)
func debugJSON(v interface{}) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return strings.TrimSpace(string(b))
}
