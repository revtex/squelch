//go:build windows

package admin

import "golang.org/x/sys/windows"

// volumeSpace reports the size and free space of the volume holding path,
// or zeros when it cannot be read.
func volumeSpace(path string) (total, free uint64) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0
	}
	var freeToCaller, totalBytes, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(p, &freeToCaller, &totalBytes, &totalFree); err != nil {
		return 0, 0
	}
	return totalBytes, freeToCaller
}
