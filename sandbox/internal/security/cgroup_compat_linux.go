//go:build linux

// cgroup v1 + v2 compatibility layer · v0.3 Phase 4 hardening
//
// Detects whether the host uses cgroup v1 (legacy hierarchy) or
// cgroup v2 (unified hierarchy) and writes resource limits to the
// right path. Some older kernels (e.g. CentOS 7) and most k8s
// clusters before 1.21 default to v1.
//
// v1 layout (legacy): /sys/fs/cgroup/{cpu,memory,pids}/<slice>/<file>
// v2 layout (unified): /sys/fs/cgroup/<slice>/<file>
package security

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// CgroupVersion identifies the cgroup hierarchy version on the host.
type CgroupVersion int

const (
	CgroupUnknown CgroupVersion = iota
	CgroupV1
	CgroupV2
)

// DetectCgroupVersion inspects /proc/self/cgroup + /sys/fs/cgroup
// to determine whether we're running under cgroup v1 or v2.
//
// Logic:
//   - /proc/self/cgroup format differs by version:
//     v1: "hierarchy-ID:controller-list:cgroup-path"
//     v2: "0::cgroup-path"
//   - If we see a "0::" line, v2 is in use.
//   - Otherwise, look for /sys/fs/cgroup/{memory,cpu,pids} subdirs
//     (v1 controllers). If present, v1.
func DetectCgroupVersion() CgroupVersion {
	// Read /proc/self/cgroup
	data, err := os.ReadFile("/proc/self/cgroup")
	if err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			// v2 line: "0::/path" — single 0 before the first colon
			parts := strings.SplitN(line, ":", 3)
			if len(parts) >= 2 && parts[0] == "0" && parts[1] == "" {
				return CgroupV2
			}
		}
	}
	// Check for v1 controller subdirectories
	for _, ctl := range []string{"memory", "cpu", "pids"} {
		if _, err := os.Stat(filepath.Join("/sys/fs/cgroup", ctl)); err == nil {
			return CgroupV1
		}
	}
	return CgroupUnknown
}

// CgroupPaths maps a cgroup slice name to the actual filesystem paths
// where resource limits should be written.
type CgroupPaths struct {
	Version   CgroupVersion
	MemoryMax string
	CPUMax    string
	PidsMax   string
}

// ResolveCgroupPaths returns the actual file paths for a given slice
// name (e.g. "dasheng.slice/sandbox-123.scope").
func ResolveCgroupPaths(slicePath string) (CgroupPaths, error) {
	v := DetectCgroupVersion()
	p := CgroupPaths{Version: v}
	switch v {
	case CgroupV2:
		base := filepath.Join("/sys/fs/cgroup", slicePath)
		p.MemoryMax = filepath.Join(base, "memory.max")
		p.CPUMax = filepath.Join(base, "cpu.max")
		p.PidsMax = filepath.Join(base, "pids.max")
	case CgroupV1:
		p.MemoryMax = filepath.Join("/sys/fs/cgroup/memory", slicePath, "memory.limit_in_bytes")
		cpuQuota := filepath.Join("/sys/fs/cgroup/cpu", slicePath, "cpu.cfs_quota_us")
		cpuPeriod := filepath.Join("/sys/fs/cgroup/cpu", slicePath, "cpu.cfs_period_us")
		p.CPUMax = cpuQuota + "|" + cpuPeriod
		p.PidsMax = filepath.Join("/sys/fs/cgroup/pids", slicePath, "pids.max")
	default:
		return p, fmt.Errorf("cannot detect cgroup version")
	}
	return p, nil
}

// ApplyCgroupV1 writes resource limits to the v1 hierarchy.
func ApplyCgroupV1(slicePath string, lim Limiter) (string, func(), error) {
	paths, err := ResolveCgroupPaths(slicePath)
	if err != nil {
		return slicePath, nil, err
	}
	if paths.Version != CgroupV1 {
		return slicePath, nil, fmt.Errorf("ApplyCgroupV1 called but version=%v", paths.Version)
	}
	for _, p := range []string{
		filepath.Dir(paths.MemoryMax),
		filepath.Dir(strings.Split(paths.CPUMax, "|")[0]),
		filepath.Dir(paths.PidsMax),
	} {
		if err := os.MkdirAll(p, 0o755); err != nil {
			return slicePath, nil, fmt.Errorf("mkdir %s: %w", p, err)
		}
	}
	if lim.MemoryMaxBytes > 0 {
		if err := writeCgroupFile(paths.MemoryMax, itoa64(lim.MemoryMaxBytes)); err != nil {
			return slicePath, nil, fmt.Errorf("write memory: %w", err)
		}
	}
	if lim.CPUQuotaPercent > 0 {
		parts := strings.Split(paths.CPUMax, "|")
		if len(parts) == 2 {
			quota := int64(lim.CPUQuotaPercent) * 1000
			if err := writeCgroupFile(parts[0], itoa64(quota)); err != nil {
				return slicePath, nil, fmt.Errorf("write cpu quota: %w", err)
			}
			if err := writeCgroupFile(parts[1], "100000"); err != nil {
				return slicePath, nil, fmt.Errorf("write cpu period: %w", err)
			}
		}
	}
	if lim.PidsMax > 0 {
		if err := writeCgroupFile(paths.PidsMax, itoa(lim.PidsMax)); err != nil {
			return slicePath, nil, fmt.Errorf("write pids: %w", err)
		}
	}
	cleanup := func() {
		for _, p := range []string{
			filepath.Dir(paths.MemoryMax),
			filepath.Dir(strings.Split(paths.CPUMax, "|")[0]),
			filepath.Dir(paths.PidsMax),
		} {
			_ = os.Remove(p)
		}
	}
	return slicePath, cleanup, nil
}

// ApplyCgroupAuto detects the cgroup version and applies limits.
func ApplyCgroupAuto(slicePath string, lim Limiter) (string, func(), error) {
	v := DetectCgroupVersion()
	switch v {
	case CgroupV2:
		return ApplyCgroupV2(slicePath, lim)
	case CgroupV1:
		return ApplyCgroupV1(slicePath, lim)
	default:
		return slicePath, nil, fmt.Errorf("unknown cgroup version")
	}
}

// ApplyCgroupV2 is the v2-only path.
func ApplyCgroupV2(slicePath string, lim Limiter) (string, func(), error) {
	base := filepath.Join("/sys/fs/cgroup", slicePath)
	if err := os.MkdirAll(base, 0o755); err != nil {
		return slicePath, nil, err
	}
	if lim.MemoryMaxBytes > 0 {
		if err := writeCgroupFile(filepath.Join(base, "memory.max"), itoa64(lim.MemoryMaxBytes)); err != nil {
			return slicePath, nil, err
		}
	}
	if lim.CPUQuotaPercent > 0 {
		quota := int64(lim.CPUQuotaPercent) * 1000
		if err := writeCgroupFile(filepath.Join(base, "cpu.max"), itoa64(quota)+" 100000"); err != nil {
			return slicePath, nil, err
		}
	}
	if lim.PidsMax > 0 {
		if err := writeCgroupFile(filepath.Join(base, "pids.max"), itoa(lim.PidsMax)); err != nil {
			return slicePath, nil, err
		}
	}
	cleanup := func() { _ = os.Remove(base) }
	return slicePath, cleanup, nil
}
