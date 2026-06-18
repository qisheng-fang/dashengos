// metrics.go — minimal Prometheus metrics for the sandbox daemon.
//
// Exposes a `metrics.snapshot` IPC method that returns the metrics
// in Prometheus text format (what /metrics would return on a normal
// HTTP exporter). The supervisord/k8s Prometheus scraper can call
// this periodically.
//
// We avoid the full prometheus/client_golang dep to keep the binary
// stdlib-only; counters are kept in a simple struct.
package handlers

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Metrics holds per-method counters and a few gauges.
type Metrics struct {
	mu            sync.Mutex
	startTime     time.Time
	methodCalls   map[string]*atomic.Int64
	methodLatency map[string]*atomic.Int64 // microseconds, total
	methodErrors  map[string]*atomic.Int64
	activeConns   atomic.Int64
	totalConns    atomic.Int64
}

var GlobalMetrics = newMetrics()

func newMetrics() *Metrics {
	return &Metrics{
		startTime:     time.Now(),
		methodCalls:   make(map[string]*atomic.Int64),
		methodLatency: make(map[string]*atomic.Int64),
		methodErrors:  make(map[string]*atomic.Int64),
	}
}

// RecordCall bumps the counter for a method and tracks latency.
// Called by ipc.Server after each dispatch.
func (m *Metrics) RecordCall(method string, latencyUs int64, isError bool) {
	m.mu.Lock()
	c, ok := m.methodCalls[method]
	if !ok {
		c = new(atomic.Int64)
		m.methodCalls[method] = c
	}
	lt, ok := m.methodLatency[method]
	if !ok {
		lt = new(atomic.Int64)
		m.methodLatency[method] = lt
	}
	er, ok := m.methodErrors[method]
	if !ok {
		er = new(atomic.Int64)
		m.methodErrors[method] = er
	}
	m.mu.Unlock()
	c.Add(1)
	lt.Add(latencyUs)
	if isError {
		er.Add(1)
	}
}

func (m *Metrics) ConnOpened()  { m.activeConns.Add(1); m.totalConns.Add(1) }
func (m *Metrics) ConnClosed()  { m.activeConns.Add(-1) }

// MetricsSnapshot is the JSON result of `metrics.snapshot`.
type MetricsSnapshot struct {
	UpSec        int64                      `json:"uptime_sec"`
	ActiveConns  int64                      `json:"active_conns"`
	TotalConns   int64                      `json:"total_conns"`
	MethodCalls  map[string]int64           `json:"method_calls"`
	MethodErrors map[string]int64           `json:"method_errors"`
	AvgLatencyMs map[string]float64         `json:"avg_latency_ms"`
	PromText     string                     `json:"prom_text"`
}

// MetricsSnapshotHandler returns a JSON-RPC handler that returns
// the current metrics in both JSON and Prometheus text format.
func MetricsSnapshotHandler(_ json.RawMessage) (interface{}, error) {
	snap := GlobalMetrics.Snapshot()
	return snap, nil
}

// Snapshot builds a MetricsSnapshot including Prometheus text.
func (m *Metrics) Snapshot() MetricsSnapshot {
	m.mu.Lock()
	// Copy counters
	calls := make(map[string]int64, len(m.methodCalls))
	lat := make(map[string]int64, len(m.methodLatency))
	errs := make(map[string]int64, len(m.methodErrors))
	for k, v := range m.methodCalls {
		calls[k] = v.Load()
	}
	for k, v := range m.methodLatency {
		lat[k] = v.Load()
	}
	for k, v := range m.methodErrors {
		errs[k] = v.Load()
	}
	m.mu.Unlock()
	// Avg latency
	avg := make(map[string]float64, len(calls))
	for k, c := range calls {
		if c == 0 {
			avg[k] = 0
			continue
		}
		avg[k] = float64(lat[k]) / float64(c) / 1000.0 // us → ms
	}
	// Prometheus text format
	upSec := int64(time.Since(m.startTime).Seconds())
	prom := buildPromText(upSec, m.activeConns.Load(), m.totalConns.Load(), calls, errs, avg)
	return MetricsSnapshot{
		UpSec:        upSec,
		ActiveConns:  m.activeConns.Load(),
		TotalConns:   m.totalConns.Load(),
		MethodCalls:  calls,
		MethodErrors: errs,
		AvgLatencyMs: avg,
		PromText:     prom,
	}
}

func buildPromText(upSec, activeConns, totalConns int64, calls, errs map[string]int64, avgMs map[string]float64) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# HELP dasheng_sandbox_uptime_seconds Seconds since daemon start\n")
	fmt.Fprintf(&b, "# TYPE dasheng_sandbox_uptime_seconds gauge\n")
	fmt.Fprintf(&b, "dasheng_sandbox_uptime_seconds %d\n\n", upSec)

	fmt.Fprintf(&b, "# HELP dasheng_sandbox_active_conns Currently open client connections\n")
	fmt.Fprintf(&b, "# TYPE dasheng_sandbox_active_conns gauge\n")
	fmt.Fprintf(&b, "dasheng_sandbox_active_conns %d\n\n", activeConns)

	fmt.Fprintf(&b, "# HELP dasheng_sandbox_total_conns Total client connections since start\n")
	fmt.Fprintf(&b, "# TYPE dasheng_sandbox_total_conns counter\n")
	fmt.Fprintf(&b, "dasheng_sandbox_total_conns %d\n\n", totalConns)

	// Per-method metrics
	keys := make([]string, 0, len(calls))
	for k := range calls {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	fmt.Fprintf(&b, "# HELP dasheng_sandbox_method_calls_total Total IPC calls per method\n")
	fmt.Fprintf(&b, "# TYPE dasheng_sandbox_method_calls_total counter\n")
	for _, k := range keys {
		fmt.Fprintf(&b, "dasheng_sandbox_method_calls_total{method=%q} %d\n", k, calls[k])
	}
	b.WriteString("\n")

	fmt.Fprintf(&b, "# HELP dasheng_sandbox_method_errors_total Total IPC errors per method\n")
	fmt.Fprintf(&b, "# TYPE dasheng_sandbox_method_errors_total counter\n")
	for _, k := range keys {
		fmt.Fprintf(&b, "dasheng_sandbox_method_errors_total{method=%q} %d\n", k, errs[k])
	}
	b.WriteString("\n")

	fmt.Fprintf(&b, "# HELP dasheng_sandbox_method_latency_ms_avg Average latency per method\n")
	fmt.Fprintf(&b, "# TYPE dasheng_sandbox_method_latency_ms_avg gauge\n")
	for _, k := range keys {
		fmt.Fprintf(&b, "dasheng_sandbox_method_latency_ms_avg{method=%q} %.3f\n", k, avgMs[k])
	}
	return b.String()
}
