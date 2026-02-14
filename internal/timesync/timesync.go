package timesync

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// SyncLogEntry represents a single NTP sync event
type SyncLogEntry struct {
	Timestamp int64   `json:"ts"`
	OffsetMs  float64 `json:"offset_ms"`
	Source    string  `json:"source"`
}

// TimeStatus represents the current time synchronization state
type TimeStatus struct {
	Timestamp   int64   `json:"ts"`
	UnitID      string  `json:"unit_id"`
	Sequence    int     `json:"seq,omitempty"`
	
	// PTP Status
	PTPEnabled  bool    `json:"ptp_enabled"`
	PTPMaster   string  `json:"ptp_master,omitempty"`
	PTPOffset   int64   `json:"ptp_offset_ns"`      // Offset from master (ns)
	PTPPathDelay int64  `json:"ptp_path_delay_ns"`  // Path delay (ns)
	PTPStratum  int     `json:"ptp_stratum"`
	PTPState    string  `json:"ptp_state"`          // s0, s1, s2, etc.
	
	// NTP/Chrony Status
	NTPEnabled      bool           `json:"ntp_enabled"`
	NTPOffset       float64        `json:"ntp_offset_ms"`       // Offset from NTP server (ms)
	NTPStratum      int            `json:"ntp_stratum"`
	NTPServers      []string       `json:"ntp_servers,omitempty"`
	NTPCurrentServer string        `json:"ntp_current_server,omitempty"`
	NTPSyncLog      []SyncLogEntry `json:"ntp_sync_log,omitempty"` // Last N sync events
	
	// Selected Source
	ActiveSource string `json:"active_source"`     // "ptp", "ntp", "unsynced"
	ClockQuality string `json:"clock_quality"`     // "locked", "tracking", "freerun"
}

// Monitor reads system time sync status
type Monitor struct {
	unitID     string
	mode       string  // "ptp", "chrony", "auto"
}

// NewMonitor creates a time sync monitor
func NewMonitor(unitID, mode string) *Monitor {
	return &Monitor{
		unitID: unitID,
		mode:   mode,
	}
}

// GetStatus reads current time synchronization state
func (m *Monitor) GetStatus() (*TimeStatus, error) {
	status := &TimeStatus{
		Timestamp: time.Now().UnixMilli(),
		UnitID:    m.unitID,
	}
	
	// Try PTP first
	ptpStatus := m.readPTPStatus()
	if ptpStatus != nil {
		status.PTPEnabled = true
		status.PTPMaster = ptpStatus.Master
		status.PTPOffset = ptpStatus.Offset
		status.PTPPathDelay = ptpStatus.PathDelay
		status.PTPStratum = ptpStatus.Stratum
		status.PTPState = ptpStatus.State
	}
	
	// Try Chrony/NTP
	chronyStatus := m.readChronyStatus()
	if chronyStatus != nil {
		status.NTPEnabled = true
		status.NTPOffset = chronyStatus.Offset
		status.NTPStratum = chronyStatus.Stratum
		status.NTPServers = chronyStatus.Servers
		status.NTPCurrentServer = chronyStatus.CurrentServer
		status.NTPSyncLog = chronyStatus.SyncLog
	}
	
	// Determine active source based on mode and quality
	status.ActiveSource, status.ClockQuality = m.selectBestSource(ptpStatus, chronyStatus)
	
	return status, nil
}

type ptpInfo struct {
	Master     string
	Offset     int64
	PathDelay  int64
	Stratum    int
	State      string
}

// readPTPStatus reads ptp4l status
func (m *Monitor) readPTPStatus() *ptpInfo {
	// Try to read from ptp4l socket or status file
	// First try: /run/ptp/status or similar
	data, err := os.ReadFile("/run/ptp4l-status")
	if err != nil {
		// Try alternative: query ptp4l via pmc command
		return m.queryPTPViaPMC()
	}
	
	return m.parsePTPStatus(string(data))
}

// queryPTPViaPMC uses pmc command to query ptp4l
func (m *Monitor) queryPTPViaPMC() *ptpInfo {
	cmd := exec.Command("pmc", "-u", "-b", "0", "GET CURRENT_DATA_SET")
	output, err := cmd.Output()
	if err != nil {
		return nil
	}
	
	return m.parsePMCOutput(string(output))
}

func (m *Monitor) parsePTPStatus(data string) *ptpInfo {
	info := &ptpInfo{}
	scanner := bufio.NewScanner(strings.NewReader(data))
	
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "master_offset") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				info.Offset, _ = strconv.ParseInt(parts[1], 10, 64)
			}
		} else if strings.HasPrefix(line, "path_delay") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				info.PathDelay, _ = strconv.ParseInt(parts[1], 10, 64)
			}
		} else if strings.HasPrefix(line, "gm_identity") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				info.Master = parts[1]
			}
		}
	}
	
	return info
}

func (m *Monitor) parsePMCOutput(output string) *ptpInfo {
	info := &ptpInfo{}
	scanner := bufio.NewScanner(strings.NewReader(output))
	
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, "master_offset") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "master_offset" && i+1 < len(parts) {
					info.Offset, _ = strconv.ParseInt(parts[i+1], 10, 64)
				}
			}
		} else if strings.Contains(line, "path_delay") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "path_delay" && i+1 < len(parts) {
					info.PathDelay, _ = strconv.ParseInt(parts[i+1], 10, 64)
				}
			}
		} else if strings.Contains(line, "gmIdentity") {
			parts := strings.Fields(line)
			for i, part := range parts {
				if part == "gmIdentity" && i+1 < len(parts) {
					info.Master = parts[i+1]
				}
			}
		}
	}
	
	return info
}

type chronyInfo struct {
	Offset       float64
	Stratum      int
	Servers      []string
	CurrentServer string
	SyncLog      []SyncLogEntry
	Tracking     string
}

// readChronyStatus reads chronyd tracking status
func (m *Monitor) readChronyStatus() *chronyInfo {
	cmd := exec.Command("chronyc", "tracking")
	output, err := cmd.Output()
	if err != nil {
		// Try ntpq as fallback
		return m.readNTPStatus()
	}
	
	return m.parseChronyOutput(string(output))
}

// readNTPStatus reads ntpd status as fallback
func (m *Monitor) readNTPStatus() *chronyInfo {
	cmd := exec.Command("ntpq", "-pn")
	output, err := cmd.Output()
	if err != nil {
		return nil
	}
	
	return m.parseNTPOutput(string(output))
}

func (m *Monitor) parseChronyOutput(output string) *chronyInfo {
	info := &chronyInfo{
		Servers: []string{},
		SyncLog: []SyncLogEntry{},
	}
	scanner := bufio.NewScanner(strings.NewReader(output))
	
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "Reference ID") {
			// Extract reference server
			parts := strings.Split(line, ":")
			if len(parts) >= 2 {
				ref := strings.TrimSpace(parts[1])
				info.CurrentServer = ref
				info.Servers = append(info.Servers, ref)
			}
		} else if strings.HasPrefix(line, "Stratum") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				info.Stratum, _ = strconv.Atoi(parts[1])
			}
		} else if strings.HasPrefix(line, "Last offset") {
			parts := strings.Fields(line)
			if len(parts) >= 4 {
				// Format: "Last offset : +0.000123 seconds"
				offsetStr := parts[3]
				info.Offset, _ = strconv.ParseFloat(offsetStr, 64)
				info.Offset *= 1000 // Convert to ms
				
				// Add to sync log
				if info.CurrentServer != "" {
					info.SyncLog = append(info.SyncLog, SyncLogEntry{
						Timestamp: time.Now().UnixMilli(),
						OffsetMs:  info.Offset,
						Source:    info.CurrentServer,
					})
				}
			}
		}
	}
	
	return info
}

func (m *Monitor) parseNTPOutput(output string) *chronyInfo {
	info := &chronyInfo{
		Servers: []string{},
	}
	scanner := bufio.NewScanner(strings.NewReader(output))
	
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "*") || strings.HasPrefix(line, "+") || strings.HasPrefix(line, "-") {
			// Active peer line
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				info.Servers = append(info.Servers, parts[1])
			}
			if len(parts) >= 3 {
				// stratum is typically column 3
				info.Stratum, _ = strconv.Atoi(parts[2])
			}
		}
	}
	
	return info
}

// selectBestSource determines which time source to use
func (m *Monitor) selectBestSource(ptp *ptpInfo, chrony *chronyInfo) (string, string) {
	switch m.mode {
	case "ptp":
		if ptp != nil && ptp.State != "" {
			return "ptp", m.ptpQuality(ptp)
		}
		return "unsynced", "freerun"
		
	case "chrony", "ntp":
		if chrony != nil && len(chrony.Servers) > 0 {
			return "ntp", m.ntpQuality(chrony)
		}
		return "unsynced", "freerun"
		
	case "auto":
		// Prefer PTP if available and locked
		if ptp != nil && ptp.State != "" {
			quality := m.ptpQuality(ptp)
			if quality == "locked" || quality == "tracking" {
				return "ptp", quality
			}
		}
		// Fallback to NTP
		if chrony != nil && len(chrony.Servers) > 0 {
			return "ntp", m.ntpQuality(chrony)
		}
		return "unsynced", "freerun"
		
	default:
		return "unsynced", "freerun"
	}
}

func (m *Monitor) ptpQuality(ptp *ptpInfo) string {
	if ptp == nil {
		return "freerun"
	}
	// Check offset magnitude
	if abs(ptp.Offset) < 1000 { // < 1µs
		return "locked"
	} else if abs(ptp.Offset) < 100000 { // < 100µs
		return "tracking"
	}
	return "acquiring"
}

func (m *Monitor) ntpQuality(chrony *chronyInfo) string {
	if chrony == nil {
		return "freerun"
	}
	if absFloat(chrony.Offset) < 1.0 { // < 1ms
		return "locked"
	} else if absFloat(chrony.Offset) < 10.0 { // < 10ms
		return "tracking"
	}
	return "acquiring"
}

func abs(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

func absFloat(n float64) float64 {
	if n < 0 {
		return -n
	}
	return n
}

// GetTimeConfig returns time server configuration for clients
func (m *Monitor) GetTimeConfig() map[string]interface{} {
	config := map[string]interface{}{
		"mode":        m.mode,
		"ntp_servers": getEnv("NTP_SERVERS", "pool.ntp.org"),
	}
	
	if ptpMaster := getEnv("PTP_MASTER_ADDRESS", ""); ptpMaster != "" {
		config["ptp_master"] = ptpMaster
		config["ptp_domain"] = getEnv("PTP_DOMAIN", "0")
	}
	
	return config
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// FormatOffset formats an offset for display
func FormatOffset(offsetNs int64) string {
	if abs(offsetNs) < 1000 {
		return fmt.Sprintf("%dns", offsetNs)
	} else if abs(offsetNs) < 1000000 {
		return fmt.Sprintf("%.2fµs", float64(offsetNs)/1000)
	} else if abs(offsetNs) < 1000000000 {
		return fmt.Sprintf("%.2fms", float64(offsetNs)/1000000)
	}
	return fmt.Sprintf("%.2fs", float64(offsetNs)/1000000000)
}
