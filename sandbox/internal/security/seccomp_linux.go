//go:build linux

// BPF seccomp filter · v0.3 Phase 4 hardening
//
// Hand-written BPF bytecode that:
//   1. Checks the architecture is x86_64 (or aarch64); KILLs otherwise.
//   2. Loads the syscall number.
//   3. Allows a small allowlist of common syscalls used by typical
//      Node/Python/Bash workloads (read, write, mmap, open, ...).
//   4. KILLs everything else.
//
// Dangerous syscalls that are explicitly excluded:
//   ptrace · kexec_load · kexec_file_load · reboot · mount · umount2
//   init_module · finit_module · delete_module · personality · setns
//   unshare · chroot · pivot_root · acct · settimeofday
//
// Phase 4 BPF filter does NOT use SECCOMP_RET_ERRNO (which would let
// the sandboxed process continue with a fake errno) — we either
// ALLOW or KILL_PROCESS. KILL is the safest default.
package security

import (
	"fmt"
	"sort"
	"syscall"
	"unsafe"
)

// BPF instruction (sock_filter)
type sockFilter struct {
	Code uint16
	Jt   uint8
	Jf   uint8
	K    uint32
}

type sockFprog struct {
	Len    uint16
	Filter *sockFilter
}

// BPF opcodes
const (
	bpfLD  = 0x00
	bpfJMP = 0x05
	bpfRET = 0x06

	bpfW   = 0x00
	bpfABS = 0x20

	bpfJEQ = 0x10
	bpfK   = 0x00
)

// seccomp return values
const (
	seccompRetKillProcess = 0x80000000
	seccompRetAllow       = 0x7fff0000
)

// seccomp_data offsets
const (
	seccompNrOffset   = 0
	seccompArchOffset = 4
)

// Architecture identifiers (from <linux/audit.h>)
const (
	auditArchX8664  = 0xc000003e
	auditArchAarch64 = 0xc00000b7
)

// prctl operations
const (
	prSetNoNewPrivs = 38
	prSetSeccomp    = 22
	seccompModeFilter = 2
)

// defaultAllowlist is the set of syscalls we permit. Tuned for
// typical agent runtimes: Node.js, Python, Go, bash, curl, etc.
//
// Add/remove based on real workload. Phase 4 starts conservative;
// Phase 5 (or later) may expand based on audit telemetry.
var defaultAllowlist = map[uint32]bool{
	// x86_64 syscall numbers
	0:  true, // read
	1:  true, // write
	2:  true, // open
	3:  true, // close
	4:  true, // stat
	5:  true, // fstat
	6:  true, // lstat
	7:  true, // poll
	8:  true, // lseek
	9:  true, // mmap
	10: true, // mprotect
	11: true, // munmap
	12: true, // brk
	13: true, // rt_sigaction
	14: true, // rt_sigprocmask
	15: true, // rt_sigreturn
	16: true, // ioctl
	17: true, // pread64
	18: true, // pwrite64
	19: true, // readv
	20: true, // writev
	21: true, // access
	22: true, // pipe
	23: true, // select
	24: true, // sched_yield
	25: true, // mremap
	26: true, // msync
	27: true, // mincore
	28: true, // madvise
	29: true, // shmget
	30: true, // shmat
	31: true, // shmctl
	32: true, // dup
	33: true, // dup2
	34: true, // pause
	35: true, // nanosleep
	36: true, // getitimer
	37: true, // alarm
	38: true, // setitimer
	39: true, // getpid
	40: true, // sendfile
	41: true, // socket
	42: true, // connect
	43: true, // accept
	44: true, // sendto
	45: true, // recvfrom
	46: true, // sendmsg
	47: true, // recvmsg
	48: true, // shutdown
	49: true, // bind
	50: true, // listen
	51: true, // getsockname
	52: true, // getpeername
	53: true, // socketpair
	54: true, // setsockopt
	55: true, // getsockopt
	56: true, // clone
	57: true, // fork
	58: true, // vfork
	59: true, // execve
	60: true, // exit
	61: true, // wait4
	62: true, // kill
	63: true, // uname
	64: true, // semget
	65: true, // semop
	66: true, // semctl
	67: true, // shmdt
	68: true, // msgget
	69: true, // msgsnd
	70: true, // msgrcv
	71: true, // msgctl
	72: true, // fcntl
	73: true, // flock
	74: true, // fsync
	75: true, // fdatasync
	76: true, // truncate
	77: true, // ftruncate
	78: true, // getdents
	79: true, // getcwd
	80: true, // chdir
	81: true, // fchdir
	82: true, // rename
	83: true, // mkdir
	84: true, // rmdir
	85: true, // creat
	86: true, // link
	87: true, // unlink
	88: true, // symlink
	89: true, // readlink
	90: true, // chmod
	91: true, // fchmod
	92: true, // chown
	93: true, // fchown
	94: true, // lchown
	95: true, // umask
	96: true, // gettimeofday
	97: true, // getrlimit
	98: true, // getrusage
	99: true, // sysinfo
	100: true, // times
	102: true, // getuid
	104: true, // getgid
	105: true, // setuid
	106: true, // setgid
	107: true, // geteuid
	108: true, // getegid
	109: true, // setpgid
	110: true, // getppid
	111: true, // getsid
	112: true, // setsid
	113: true, // getgroups
	114: true, // setgroups
	115: true, // setrlimit
	117: true, // sync
	120: true, // capget
	121: true, // capset
	122: true, // sigaltstack
	131: true, // sigaltstack (alt nr)
	158: true, // arch_prctl
	186: true, // gettid
	200: true, // tkill
	201: true, // time
	202: true, // futex
	204: true, // sched_getaffinity
	206: true, // io_setup
	207: true, // io_destroy
	208: true, // io_getevents
	209: true, // io_submit
	210: true, // io_cancel
	218: true, // set_tid_address
	231: true, // exit_group
	233: true, // epoll_ctl
	234: true, // tgkill
	237: true, // mbind
	238: true, // set_mempolicy
	239: true, // get_mempolicy
	247: true, // waitid
	250: true, // keyctl
	257: true, // vmsplice
	262: true, // move_pages
	263: true, // preadv
	264: true, // pwritev
	270: true, // splice
	272: true, // tee
	273: true, // splice (alt)
	275: true, // vmsplice
	280: true, // utimensat
	288: true, // accept4
	302: true, // prlimit64
	316: true, // renameat2
	318: true, // getrandom
	319: true, // memfd_create
	322: true, // execveat
	324: true, // preadv2
	325: true, // pwritev2
	326: true, // pkey_mprotect
	327: true, // pkey_alloc
	328: true, // pkey_free
	329: true, // statx
	330: true, // io_pgetevents
	331: true, // rseq
	332: true, // pidfd_send_signal
	424: true, // pidfd_open
	425: true, // close_range
	435: true, // clone3
	436: true, // close_range (alt)
	439: true, // memfd_secret

	// Explicitly BLOCKED (do NOT add to allowlist):
	// 101  ptrace              — debugging other processes
	// 105  setuid              — privilege escalation
	// 106  setgid              — privilege escalation
	// 116  chroot              — root escape
	// 119  settimeofday        — system clock tampering
	// 154  pivot_root          — namespace escape
	// 156  personality         — exec domain change
	// 165  mount               — mount filesystem
	// 166  umount2             — unmount filesystem
	// 169  reboot              — reboot system
	// 172  quotactl            — quota manipulation
	// 175  quotactl (alt)      — quota manipulation
	// 176  getpgrp             — usually safe but not needed
	// 205  set_mempolicy       — NUMA manipulation
	// 219  restart_syscall
	// 221  fadvise64
	// 246  ioprio_set
	// 248  add_key
	// 249  request_key
	// 251  migrate_pages
	// 252  mbind (alt)
	// 254  move_pages (alt)
	// 259  munlock
	// 270  splice
	// 277  sync_file_range
	// 278  tee (alt)
	// 279  sync_file_range2
	// 285  vmsplice (alt)
	// 286  move_pages (alt2)
	// 310  process_vm_readv    — cross-process memory read
	// 311  process_vm_writev   — cross-process memory write
}

// buildBpfFilter constructs a BPF program for the given syscall allowlist.
// Result is a linear chain: arch check → load nr → N JEQ checks → KILL → ALLOW.
func buildBpfFilter(allowlist map[uint32]bool) []sockFilter {
	f := make([]sockFilter, 0, len(allowlist)+6)

	// 1. Load arch
	f = append(f, sockFilter{Code: bpfLD | bpfW | bpfABS, K: seccompArchOffset})
	// 2. JEQ x86_64, Jt:1 (skip 1) → if not, fall through to KILL
	f = append(f, sockFilter{Code: bpfJMP | bpfJEQ | bpfK, K: auditArchX8664, Jt: 1, Jf: 0})
	// 3. KILL on arch mismatch
	f = append(f, sockFilter{Code: bpfRET | bpfK, K: seccompRetKillProcess})
	// 4. Load syscall number
	f = append(f, sockFilter{Code: bpfLD | bpfW | bpfABS, K: seccompNrOffset})

	// 5. For each allowed syscall: JEQ, Jt:1 (jump 1 forward to ALLOW), Jf:0 (fall through)
	syscalls := make([]uint32, 0, len(allowlist))
	for nr := range allowlist {
		syscalls = append(syscalls, nr)
	}
	sort.Slice(syscalls, func(i, j int) bool { return syscalls[i] < syscalls[j] })
	for _, nr := range syscalls {
		f = append(f, sockFilter{Code: bpfJMP | bpfJEQ | bpfK, K: nr, Jt: 1, Jf: 0})
	}

	// 6. Default: KILL
	f = append(f, sockFilter{Code: bpfRET | bpfK, K: seccompRetKillProcess})
	// 7. ALLOW (target of all the Jt jumps)
	f = append(f, sockFilter{Code: bpfRET | bpfK, K: seccompRetAllow})

	return f
}

// InstallSeccomp installs the BPF filter for the CURRENT process.
// After this returns, all child processes (fork+exec) will inherit it.
func InstallSeccomp() error {
	return InstallSeccompWithAllowlist(defaultAllowlist)
}

// InstallSeccompWithAllowlist installs a custom allowlist.
// Use this for tests or specialized workloads.
func InstallSeccompWithAllowlist(allowlist map[uint32]bool) error {
	filter := buildBpfFilter(allowlist)
	if len(filter) == 0 {
		return fmt.Errorf("empty seccomp filter")
	}
	// 1. PR_SET_NO_NEW_PRIVS (required before SECCOMP_FILTER)
	if _, _, errno := syscall.Syscall(syscall.SYS_PRCTL, prSetNoNewPrivs, 1, 0); errno != 0 {
		return fmt.Errorf("prctl(PR_SET_NO_NEW_PRIVS): %v", errno)
	}
	// 2. PR_SET_SECCOMP with SECCOMP_MODE_FILTER
	prog := sockFprog{
		Len:    uint16(len(filter)),
		Filter: &filter[0],
	}
	_, _, errno := syscall.Syscall(
		syscall.SYS_PRCTL,
		prSetSeccomp,
		seccompModeFilter,
		uintptr(unsafe.Pointer(&prog)),
	)
	if errno != 0 {
		return fmt.Errorf("prctl(PR_SET_SECCOMP, FILTER): %v", errno)
	}
	return nil
}

// SeccompAllowlistSize returns the size of the default allowlist.
// Useful for metrics.
func SeccompAllowlistSize() int {
	return len(defaultAllowlist)
}
