//go:build !windows

package admin

import "syscall"

// volumeSpace reports the size and free space of the filesystem holding
// path, or zeros when it cannot be read.
func volumeSpace(path string) (total, free uint64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0
	}
	bsize := uint64(st.Bsize) //nolint:unconvert // Bsize is int64 on some platforms
	return st.Blocks * bsize, st.Bavail * bsize
}
