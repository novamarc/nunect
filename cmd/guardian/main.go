package main

import (
	"fmt"
	"time"
	"log"
	"nunect/internal/config"
	"github.com/nats-io/nats.go"
)

func main() {
	// Hier wird 'p' als Instanz deines geladenen Profils erstellt
	p, err := config.Load("connector-profile.yaml")
	if err != nil {
		log.Fatalf("Konnte Profil nicht laden: %v", err)
	}

	// Jetzt ist 'p' bekannt und wir können darauf zugreifen
	log.Printf("Guardian geladen: %s", p.Metadata.UnitID)

	// Verbindung zum NATS-Master
	nc, err := nats.Connect(nats.DefaultURL)
	if err != nil {
		log.Fatalf("NATS Fehler: %v", err)
	}
	defer nc.Close()

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
