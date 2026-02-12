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

	"github.com/nats-io/nats.go"
)

// RTTMetrics represents a single RTT measurement
type RTTMetrics struct {
	Timestamp int64 `json:"ts"`
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

	if user == "" || pass == "" {
		log.Fatal("NATS_SYS_USER oder NATS_SYS_PASSWORD nicht gesetzt!")
	}

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

	// Setup echo responder for app-level RTT measurement
	// Any client can send a request to this subject to measure full round-trip
	echoSubject := fmt.Sprintf("ops.echo.%s", p.Metadata.UnitID)
	_, err = nc.Subscribe(echoSubject, func(msg *nats.Msg) {
		// Echo back with minimal processing
		// Add server receive timestamp for clock drift analysis
		receivedAt := time.Now().UnixMicro()
		
		headers := nats.Header{}
		if msg.Header != nil {
			// Copy through any existing headers
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
	metricsSubject := fmt.Sprintf("ops.metric.rtt.%s", p.Metadata.UnitID)

	for range ticker.C {
		sequence++

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

		// 3. Build metrics
		now := time.Now()
		metrics := RTTMetrics{
			Timestamp: now.UnixMilli(),
			UnitID:    p.Metadata.UnitID,
			Sequence:  sequence,
			NativeRTT: nativeRTT.Microseconds(),
			AppRTT:    appRTT.Microseconds(),
		}

		// 4. Publish heartbeat with metadata
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
		}

		if err := nc.PublishMsg(&nats.Msg{
			Subject: heartbeatSubject,
			Data:    heartbeatJSON,
			Header:  headers,
		}); err != nil {
			log.Printf("Failed to publish heartbeat: %v", err)
			continue
		}

		// 5. Publish detailed metrics to separate subject
		metricsJSON, _ := json.Marshal(metrics)
		if err := nc.Publish(metricsSubject, metricsJSON); err != nil {
			log.Printf("Failed to publish metrics: %v", err)
		}

		nc.Flush()
		log.Printf("[%s] seq=%d native=%v app=%v",
			p.Metadata.UnitID, sequence, nativeRTT, appRTT)
	}
}

// measureAppRTT performs a request-reply to measure full application latency
// Returns: total round-trip time (includes network + server processing + response)
func measureAppRTT(nc *nats.Conn, subject string) time.Duration {
	start := time.Now()
	
	_, err := nc.Request(subject, []byte("ping"), 2*time.Second)
	if err != nil {
		return 0
	}
	
	return time.Since(start)
}
