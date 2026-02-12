package main

import (
	"os"
	"time"
	"log"
	"crypto/tls"
	"fmt"
	"nunect/internal/config"
	"github.com/nats-io/nats.go"
)

func main() {
	p, _ := config.Load("connector-profile.yaml")

	// 1. Zugangsdaten aus der .env / Umgebung laden
	user := os.Getenv("NATS_SYS_USER")
	pass := os.Getenv("NATS_SYS_PASSWORD")
	serverURL := os.Getenv("NATS_URL") // z.B. nats://127.0.0.1:4222

	if user == "" || pass == "" {
		log.Fatal("NATS_SYS_USER oder NATS_SYS_PASSWORD nicht gesetzt!")
	}

	// 2. Verbindung mit TLS & Auth
	opts := []nats.Option{
		nats.UserInfo(user, pass),
		// Da du WSS/TLS nutzt, aktivieren wir Secure-Mode
		// InsecureSkipVerify: true, falls das Cert self-signed ist
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
    
    // ... Rest deines Codes (Heartbeat/Parrot)

	log.Println("Verbunden mit NATS Master.")

	// Heartbeat-Loop
	ticker := time.NewTicker(5 * time.Second)
	// Innerhalb der for-Schleife in main.go:
	for range ticker.C {
    subject := fmt.Sprintf("ops.heartbeat.%s", p.Metadata.UnitID)
    
    // Hier ist der Guardian-Check:
    if !p.IsAllowed(subject, "pub") {
        log.Printf("SECURITY ALERT: Senden auf %s verboten!", subject)
        continue
    }

    nc.Publish(subject, []byte("Healthy"))
    nc.Flush()
    log.Printf("Gesendet: %s", subject)
}
}
