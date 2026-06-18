//go:build linux

package security

import (
	"sort"
	"testing"
)

func TestBuildBpfFilterBasicShape(t *testing.T) {
	allow := map[uint32]bool{
		0:  true, // read
		1:  true, // write
		60: true, // exit
	}
	f := buildBpfFilter(allow)
	// Expected: 4 (arch+nr+kill_pre+kill_post is wrong, let me recount)
	// 1. LD arch, 2. JEQ arch, 3. RET KILL, 4. LD nr, 5-7. JEQ read/write/exit, 8. RET KILL, 9. RET ALLOW
	want := 4 + len(allow) + 2 // 4 prefix + N checks + 2 suffix
	if len(f) != want {
		t.Errorf("filter length = %d, want %d (4+N+2)", len(f), want)
	}
	// First instruction: load arch
	if f[0].Code != bpfLD|bpfW|bpfABS || f[0].K != seccompArchOffset {
		t.Errorf("f[0] = %+v, want load arch", f[0])
	}
	// Last instruction: ALLOW
	last := f[len(f)-1]
	if last.Code != bpfRET|bpfK || last.K != seccompRetAllow {
		t.Errorf("last = %+v, want RET ALLOW", last)
	}
	// Second-to-last: KILL (default)
	secondLast := f[len(f)-2]
	if secondLast.Code != bpfRET|bpfK || secondLast.K != seccompRetKillProcess {
		t.Errorf("second-last = %+v, want RET KILL", secondLast)
	}
}

func TestBuildBpfFilterSyscallOrder(t *testing.T) {
	allow := map[uint32]bool{42: true, 5: true, 100: true}
	f := buildBpfFilter(allow)
	// The 4th instruction (index 3) is LD nr. Then JEQ for each syscall in sorted order.
	sortedKeys := []uint32{5, 42, 100}
	sort.Slice(sortedKeys, func(i, j int) bool { return sortedKeys[i] < sortedKeys[j] })
	// Wait, already in ascending order; 5 < 42 < 100.
	for i, k := range sortedKeys {
		jeq := f[4+i]
		if jeq.Code != bpfJMP|bpfJEQ|bpfK {
			t.Errorf("f[%d] code = %#x, want JEQ", 4+i, jeq.Code)
		}
		if jeq.K != k {
			t.Errorf("f[%d].K = %d, want %d", 4+i, jeq.K, k)
		}
		if jeq.Jt != 1 {
			t.Errorf("f[%d].Jt = %d, want 1", 4+i, jeq.Jt)
		}
		if jeq.Jf != 0 {
			t.Errorf("f[%d].Jf = %d, want 0", 4+i, jeq.Jf)
		}
	}
}

func TestBuildBpfFilterEmptyAllowlist(t *testing.T) {
	f := buildBpfFilter(map[uint32]bool{})
	// Just the prefix + KILL + ALLOW
	if len(f) != 6 {
		t.Errorf("empty allowlist filter length = %d, want 6 (4+0+2)", len(f))
	}
}

func TestBuildBpfFilterArchCheckIsFirst(t *testing.T) {
	// Verify that arch check is the second instruction (after LD arch).
	f := buildBpfFilter(map[uint32]bool{0: true})
	if f[1].Code != bpfJMP|bpfJEQ|bpfK {
		t.Errorf("f[1] code = %#x, want JEQ", f[1].Code)
	}
	if f[1].K != auditArchX8664 {
		t.Errorf("f[1].K = %#x, want x86_64 audit arch %#x", f[1].K, auditArchX8664)
	}
	if f[1].Jt != 1 {
		t.Errorf("f[1].Jt = %d, want 1 (skip 1 forward)", f[1].Jt)
	}
}

func TestSeccompAllowlistSize(t *testing.T) {
	n := SeccompAllowlistSize()
	if n < 50 {
		t.Errorf("default allowlist has %d syscalls, want ≥50", n)
	}
	// Sanity: critical syscalls are allowed
	critical := []uint32{0, 1, 2, 3, 9, 60, 231} // read, write, open, close, mmap, exit, exit_group
	for _, c := range critical {
		if !defaultAllowlist[c] {
			t.Errorf("critical syscall %d not in allowlist", c)
		}
	}
	// Sanity: dangerous syscalls are NOT allowed
	dangerous := []uint32{101, 119, 165, 169, 172} // ptrace, settimeofday, mount, reboot, quotactl
	for _, d := range dangerous {
		if defaultAllowlist[d] {
			t.Errorf("dangerous syscall %d IS in allowlist (should be blocked)", d)
		}
	}
}

func TestBuildBpfFilterIncludesKILLForDefaultDeny(t *testing.T) {
	f := buildBpfFilter(map[uint32]bool{0: true})
	// Last 2 instructions should be KILL + ALLOW
	last2 := f[len(f)-2:]
	if last2[0].K != seccompRetKillProcess {
		t.Errorf("second-to-last K = %#x, want KILL %#x", last2[0].K, seccompRetKillProcess)
	}
	if last2[1].K != seccompRetAllow {
		t.Errorf("last K = %#x, want ALLOW %#x", last2[1].K, seccompRetAllow)
	}
}
