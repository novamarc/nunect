package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"time"

	"crypto/tls"
	"nunect/internal/config"
	"nunect/internal/timesync"

	"github.com/nats-io/nats.go"
)

// RTTMetrics represents a single RTT measurement
type RTTMetrics struct {
	Timestamp int64  `json:"ts"`
	UnitID    string `json:"unit_id"`
	Sequence  int    `json:"seq"`
	NativeRTT int64  `json:"native_rtt_us"` // Transport layer RTT in microseconds
	AppRTT    int64  `json:"app_rtt_us"`    // Application layer RTT in microseconds
}

func main() {
	p, err := config.Load("connector-profile.yaml")
	if err != nil {
		log.Fatalf("Failed to load profile: %v", err)
	}

	// Load credentials from .env
	user := os.Getenv("NATS_SYS_USER")
	pass := os.Getenv("NATS_SYS_PASSWORD")
	serverURL := os.Getenv("NATS_URL")
	timeSyncMode := os.Getenv("TIME_SYNC_MODE")
	if timeSyncMode == "" {
		timeSyncMode = "auto"
	}

	if user == "" || pass == "" {
		log.Fatal("NATS_SYS_USER oder NATS_SYS_PASSWORD nicht gesetzt!")
	}

	// Initialize time sync monitor
	timeMonitor := timesync.NewMonitor(p.Metadata.UnitID, timeSyncMode)

	// Connect with TLS & Auth
	opts := []nats.Option{
		nats.UserInfo(user, pass),
		nats.Secure(&tls.Config{InsecureSkipVerify: true}),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(2 * time.Second),
	}

	nc, err := nats.Connect(serverURL, opts...)
	if err != nil {
		log.Fatalf("Login fehlgeschlagen: %v", err)
	}
	defer nc.Close()

	log.Printf("Guardian [%s] erfolgreich eingeloggt!", p.Metadata.UnitID)

	// Publish time config for clients (one-time at start)
	timeConfig := timeMonitor.GetTimeConfig()
	timeConfigJSON, _ := json.Marshal(timeConfig)
	if err := nc.Publish("ops.time.config", timeConfigJSON); err != nil {
		log.Printf("Failed to publish time config: %v", err)
	}
	log.Printf("Time config published: mode=%s", timeSyncMode)

	// Setup echo responder for app-level RTT measurement
	echoSubject := fmt.Sprintf("ops.echo.%s", p.Metadata.UnitID)
	_, err = nc.Subscribe(echoSubject, func(msg *nats.Msg) {
		receivedAt := time.Now().UnixMicro()
		
		headers := nats.Header{}
		if msg.Header != nil {
			for k, v := range msg.Header {
				headers[k] = v
			}
		}
		headers.Add("X-Server-Received-At", strconv.FormatInt(receivedAt, 10))
		
		msg.RespondMsg(&nats.Msg{
			Data:    msg.Data,
			Header:  headers,
			Subject: msg.Subject,
		})
	})
	if err != nil {
		log.Printf("Failed to subscribe to echo: %v", err)
	}

	log.Printf("Echo responder active on: %s", echoSubject)

	// Heartbeat and metrics loop
	sequence := 0
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	heartbeatSubject := fmt.Sprintf("ops.heartbeat.%s", p.Metadata.UnitID)
	rttMetricsSubject := fmt.Sprintf("ops.metric.rtt.%s", p.Metadata.UnitID)
	timeMetricsSubject := fmt.Sprintf("ops.metric.time.%s", p.Metadata.UnitID)

	for range ticker.C {
		sequence++
		now := time.Now()

		// Check permissions
		if !p.IsAllowed(heartbeatSubject, "pub") {
			log.Printf("SECURITY ALERT: Senden auf %s verboten!", heartbeatSubject)
			continue
		}

		// 1. Measure Native RTT (transport layer)
		nativeRTT, err := nc.RTT()
		if err != nil {
			log.Printf("RTT measurement failed: %v", err)
			nativeRTT = 0
		}

		// 2. Measure Application RTT (full round-trip through echo)
		appRTT := measureAppRTT(nc, echoSubject)

		// 3. Get Time Sync Status
		timeStatus, err := timeMonitor.GetStatus()
		if err != nil {
			log.Printf("Time sync check failed: %v", err)
		}

		// 4. Build RTT metrics
		rttMetrics := RTTMetrics{
			Timestamp: now.UnixMilli(),
			UnitID:    p.Metadata.UnitID,
			Sequence:  sequence,
			NativeRTT: nativeRTT.Microseconds(),
			AppRTT:    appRTT.Microseconds(),
		}

		// 5. Publish heartbeat with metadata
		heartbeatData := map[string]interface{}{
			"status":   "healthy",
			"sequence": sequence,
			"ts":       now.UnixMilli(),
		}
		heartbeatJSON, _ := json.Marshal(heartbeatData)
		
		headers := nats.Header{
			"X-Unit-ID":       []string{p.Metadata.UnitID},
			"X-Sequence":      []string{strconv.Itoa(sequence)},
			"X-Native-RTT":    []string{nativeRTT.String()},
			"X-App-RTT":       []string{appRTT.String()},
			"X-Timestamp":     []string{strconv.FormatInt(now.UnixMilli(), 10)},
			"X-Clock-Source":  []string{timeStatus.ActiveSource},
			"X-Clock-Quality": []string{timeStatus.ClockQuality},
		}

		if err := nc.PublishMsg(&nats.Msg{
			Subject: heartbeatSubject,
			Data:    heartbeatJSON,
			Header:  headers,
		}); err != nil {
			log.Printf("Failed to publish heartbeat: %v", err)
			continue
		}

		// 6. Publish RTT metrics
		rttMetricsJSON, _ := json.Marshal(rttMetrics)
		if err := nc.Publish(rttMetricsSubject, rttMetricsJSON); err != nil {
			log.Printf("Failed to publish RTT metrics: %v", err)
		}

		// 7. Publish Time Sync metrics (if available)
		if timeStatus != nil {
			timeStatus.Sequence = sequence
			timeMetricsJSON, _ := json.Marshal(timeStatus)
			if err := nc.Publish(timeMetricsSubject, timeMetricsJSON); err != nil {
				log.Printf("Failed to publish time metrics: %v", err)
			}
		}

		nc.Flush()
		
		// Log summary
		if timeStatus != nil && timeStatus.ActiveSource != "unsynced" {
			log.Printf("[%s] seq=%d native=%v app=%v clock=%s/%s",
				p.Metadata.UnitID, sequence, nativeRTT, appRTT,
				timeStatus.ActiveSource, timeStatus.ClockQuality)
		} else {
			log.Printf("[%s] seq=%d native=%v app=%v",
				p.Metadata.UnitID, sequence, nativeRTT, appRTT)
		}
	}
}

// measureAppRTT performs a request-reply to measure full application latency
func measureAppRTT(nc *nats.Conn, subject string) time.Duration {
	start := time.Now()
	
	_, err := nc.Request(subject, []byte("ping"), 2*time.Second)
	if err != nil {
		return 0
	}
	
	return time.Since(start)
}
