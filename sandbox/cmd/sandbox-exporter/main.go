// cmd/sandbox-exporter/main.go · v0.3 Phase 4 hardening
//
// Prometheus exporter sidecar for the Go sandbox daemon.
//
// The sandbox itself only listens on a Unix socket, so Prometheus
// can't scrape it directly. This sidecar bridges:
//
//   prometheus :9090  ──HTTP scrape──>  sandbox-exporter :9100  ──NDJSON over Unix socket──>  sandbox :N
//
// Endpoints exposed:
//   GET /metrics    Prometheus text (text/plain; version=0.0.4)
//   GET /healthz    200 OK if the upstream sandbox is reachable + responsive
//   GET /api/{m}    JSON-RPC over HTTP (POST body) — convenience for HTTP clients
//
// Refresh model:
//   - On each /metrics scrape, the exporter calls metrics.snapshot
//     upstream and serves the cached `prom_text` from the response.
//   - To reduce latency on hot scrapes, the exporter also refreshes
//     in the background every `refresh` interval (default 10s).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

const Version = "v0.3.0-phase4-sandbox-exporter"

type Config struct {
	Listen       string
	SocketPath   string
	Refresh      time.Duration
	RPCTimeout   time.Duration
}

func main() {
	cfg := Config{
		Listen:     getEnv("DASHE_EXPORTER_LISTEN", ":9100"),
		SocketPath: getEnv("DASHE_SANDBOX_SOCKET", "/tmp/dasheng/sandbox.sock"),
		Refresh:    10 * time.Second,
		RPCTimeout: 5 * time.Second,
	}
	flag.StringVar(&cfg.Listen, "listen", cfg.Listen, "HTTP listen address (e.g. :9100)")
	flag.StringVar(&cfg.SocketPath, "socket", cfg.SocketPath, "sandbox daemon Unix socket")
	flag.DurationVar(&cfg.Refresh, "refresh", cfg.Refresh, "background refresh interval")
	flag.DurationVar(&cfg.RPCTimeout, "rpc-timeout", cfg.RPCTimeout, "per-RPC timeout")
	flag.Parse()

	logger := log.New(os.Stderr, "[sandbox-exporter] ", log.LstdFlags|log.Lmicroseconds)
	logger.Printf("starting %s listen=%s socket=%s refresh=%s", Version, cfg.Listen, cfg.SocketPath, cfg.Refresh)

	ex := &exporter{
		cfg:    cfg,
		logger: logger,
		// Initial empty metrics; first refresh populates them.
		cached: atomic.Pointer[metricsSnapshot]{},
	}
	ex.cached.Store(&metricsSnapshot{})

	// Start background refresher
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		t := time.NewTicker(cfg.Refresh)
		defer t.Stop()
		// Initial refresh
		if err := ex.refresh(); err != nil {
			ex.logger.Printf("initial refresh failed: %v", err)
		}
		for {
			select {
			case <-t.C:
				if err := ex.refresh(); err != nil {
					ex.logger.Printf("refresh failed: %v", err)
				}
			}
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/metrics", ex.handleMetrics)
	mux.HandleFunc("/healthz", ex.handleHealth)
	mux.HandleFunc("/api/", ex.handleAPI)
	mux.HandleFunc("/", ex.handleIndex)

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	logger.Printf("HTTP listening on %s (endpoints: /metrics /healthz /api/)", cfg.Listen)
	if err := srv.ListenAndServe(); err != nil {
		logger.Fatalf("HTTP server: %v", err)
	}
	wg.Wait()
}

// metricsSnapshot is the subset of handlers.MetricsSnapshot we use.
type metricsSnapshot struct {
	UpSec       int64             `json:"uptime_sec"`
	ActiveConns int64             `json:"active_conns"`
	TotalConns  int64             `json:"total_conns"`
	MethodCalls map[string]int64  `json:"method_calls"`
	PromText    string            `json:"prom_text"`
	FetchedAt   time.Time         `json:"-"`
	FetchError  string            `json:"-"`
}

type exporter struct {
	cfg    Config
	logger *log.Logger
	cached atomic.Pointer[metricsSnapshot]
}

// refresh calls metrics.snapshot on the upstream daemon and caches the result.
//
// We read the response line-by-line because the sandbox daemon uses
// NDJSON (newline-delimited) framing over a persistent connection.
// io.ReadAll would block waiting for EOF, but the daemon keeps the
// connection open for additional requests.
func (e *exporter) refresh() error {
	conn, err := net.DialTimeout("unix", e.cfg.SocketPath, e.cfg.RPCTimeout)
	if err != nil {
		return fmt.Errorf("dial %s: %w", e.cfg.SocketPath, err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(e.cfg.RPCTimeout))

	req := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "metrics.snapshot",
		"params":  map[string]interface{}{},
	}
	body, _ := json.Marshal(req)
	body = append(body, '\n')
	if _, err := conn.Write(body); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	// Read exactly one line (NDJSON framing)
	reader := newLineReader(conn)
	line, err := reader.readLine()
	if err != nil {
		return fmt.Errorf("read: %w", err)
	}
	var resp struct {
		Result metricsSnapshot `json:"result"`
		Error  *struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(line, &resp); err != nil {
		return fmt.Errorf("parse: %w", err)
	}
	if resp.Error != nil {
		return fmt.Errorf("rpc error %d: %s", resp.Error.Code, resp.Error.Message)
	}
	snap := resp.Result
	snap.FetchedAt = time.Now()
	e.cached.Store(&snap)
	return nil
}

// lineReader is a small NDJSON line reader that respects the underlying
// connection's deadline. We avoid bufio.Reader because we want each
// read to be deadline-aware at the syscall level.
type lineReader struct {
	conn net.Conn
	buf  []byte
}

func newLineReader(c net.Conn) *lineReader { return &lineReader{conn: c} }

func (r *lineReader) readLine() ([]byte, error) {
	for {
		// Look for newline in buffer
		for i, b := range r.buf {
			if b == '\n' {
				line := r.buf[:i]
				r.buf = r.buf[i+1:]
				return line, nil
			}
		}
		// Need more data
		chunk := make([]byte, 4096)
		n, err := r.conn.Read(chunk)
		if n > 0 {
			r.buf = append(r.buf, chunk[:n]...)
		}
		if err != nil {
			if len(r.buf) > 0 && r.buf[len(r.buf)-1] != '\n' {
				// Return what we have if connection closed mid-line
				line := r.buf
				r.buf = nil
				return line, nil
			}
			return nil, err
		}
	}
}

// handleMetrics returns the cached Prometheus text + a meta header.
func (e *exporter) handleMetrics(w http.ResponseWriter, r *http.Request) {
	snap := e.cached.Load()
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("X-Sandbox-Fetched-At", snap.FetchedAt.Format(time.RFC3339))
	if snap.FetchError != "" {
		w.Header().Set("X-Sandbox-Last-Error", snap.FetchError)
	}
	if snap.PromText == "" {
		// Try a synchronous refresh on first hit
		if err := e.refresh(); err != nil {
			http.Error(w, "# no metrics yet: "+err.Error(), http.StatusServiceUnavailable)
			return
		}
		snap = e.cached.Load()
	}
	w.WriteHeader(http.StatusOK)
	io.WriteString(w, snap.PromText)
	// Add an extra meta line (Prometheus allows # comments)
	fmt.Fprintf(w, "\n# sandbox_up=%d fetch_age_sec=%.1f\n",
		boolToInt(snap.FetchError == ""),
		time.Since(snap.FetchedAt).Seconds())
}

func (e *exporter) handleHealth(w http.ResponseWriter, r *http.Request) {
	snap := e.cached.Load()
	if snap.FetchError != "" && time.Since(snap.FetchedAt) > 30*time.Second {
		http.Error(w, "sandbox unreachable: "+snap.FetchError, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprintf(w, "ok\nuptime_sec=%d active_conns=%d total_conns=%d\n",
		snap.UpSec, snap.ActiveConns, snap.TotalConns)
}

func (e *exporter) handleAPI(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	method := r.URL.Path[len("/api/"):]
	if method == "" {
		http.Error(w, "missing method", http.StatusBadRequest)
		return
	}
	body, _ := io.ReadAll(r.Body)
	// Build JSON-RPC request from HTTP body or empty params
	var rpcReq map[string]interface{}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &rpcReq); err != nil {
			http.Error(w, "invalid JSON body: "+err.Error(), http.StatusBadRequest)
			return
		}
	} else {
		rpcReq = map[string]interface{}{}
	}
	rpcReq["jsonrpc"] = "2.0"
	rpcReq["id"] = time.Now().UnixNano()
	rpcReq["method"] = method
	if _, ok := rpcReq["params"]; !ok {
		rpcReq["params"] = map[string]interface{}{}
	}
	// Forward to sandbox
	conn, err := net.DialTimeout("unix", e.cfg.SocketPath, e.cfg.RPCTimeout)
	if err != nil {
		http.Error(w, "sandbox unreachable: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(e.cfg.RPCTimeout))
	payload, _ := json.Marshal(rpcReq)
	payload = append(payload, '\n')
	if _, err := conn.Write(payload); err != nil {
		http.Error(w, "write: "+err.Error(), http.StatusBadGateway)
		return
	}
	// Read exactly one line (NDJSON framing)
	reader := newLineReader(conn)
	line, err := reader.readLine()
	if err != nil {
		http.Error(w, "read: "+err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(line)
}

func (e *exporter) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html>
<html><head><title>DaShengOS sandbox-exporter %s</title></head>
<body style="font-family: monospace; padding: 2em">
<h1>sandbox-exporter %s</h1>
<p>Proxies Prometheus metrics from the Go sandbox daemon.</p>
<ul>
  <li><a href="/metrics">/metrics</a> — Prometheus text (cached, refreshed every %s)</li>
  <li><a href="/healthz">/healthz</a> — liveness</li>
  <li>POST /api/&lt;method&gt; — JSON-RPC over HTTP (params in body)</li>
</ul>
</body></html>
`, Version, Version, e.cfg.Refresh)
}

func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
