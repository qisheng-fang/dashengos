// Package security provides process isolation for the sandbox.
// See isolation_linux.go for the full Linux implementation
// (namespace+seccomp+cgroup) and isolation_other.go for the
// macOS/Windows fallback (no isolation + warning log).
package security

import (
	"log"
	"os"
	"runtime"
)

// IsolationLevel controls how aggressive the sandbox is.
type IsolationLevel int

const (
	IsolationNone     IsolationLevel = iota // no isolation (macOS dev)
	IsolationProcess                        // just fork+exec
	IsolationFull                           // namespace + seccomp + cgroup (Linux prod)
)

// Platform returns the current platform's max isolation level.
func Platform() IsolationLevel {
	if runtime.GOOS == "linux" {
		return IsolationFull
	}
	return IsolationNone
}

// IsLinux reports whether the current platform supports full isolation.
func IsLinux() bool { return runtime.GOOS == "linux" }

// WarnIfNotLinux logs a one-shot warning that production-grade
// isolation is unavailable on this platform.
func WarnIfNotLinux() {
	if !IsLinux() {
		log.Printf("[security] WARNING: platform=%s, full namespace+seccomp+cgroup isolation unavailable (production deploys to Linux)", runtime.GOOS)
	}
}

// Limiter specifies the resource limits for a sandboxed process.
type Limiter struct {
	// MemoryMaxBytes is the hard memory limit (cgroup memory.max).
	// 0 = no limit.
	MemoryMaxBytes int64
	// CPUQuotaPercent is the CPU quota (100 = 1 core).
	// 0 = no limit.
	CPUQuotaPercent int
	// PidsMax is the maximum number of processes/threads.
	// 0 = no limit.
	PidsMax int
	// TimeoutMs is the wall-clock timeout in milliseconds.
	// 0 = no timeout.
	TimeoutMs int
}

// DefaultLimiter returns the v0.3 spec §16 default limits:
// 256 MB memory, 50% CPU, 64 PIDs, 30s timeout.
func DefaultLimiter() Limiter {
	return Limiter{
		MemoryMaxBytes: 256 * 1024 * 1024,
		CPUQuotaPercent: 50,
		PidsMax:        64,
		TimeoutMs:      30_000,
	}
}

// Helper to convert int to string without strconv (kept simple)
func itoa(i int) string { return itoa64(int64(i)) }

func itoa64(i int64) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

// Used by Linux isolation code
var _ = os.Getpid // keep os import on all platforms
