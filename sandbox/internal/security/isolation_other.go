//go:build !linux

package security

// ApplyCgroup is a no-op on non-Linux platforms.
func ApplyCgroup(lim Limiter) (string, func(), error) {
	return "", func() {}, nil
}

// ApplyNamespace returns nil (no namespace) on non-Linux.
func ApplyNamespace() any { return nil }

// ApplySeccomp is a no-op on non-Linux.
func ApplySeccomp() error { return nil }
