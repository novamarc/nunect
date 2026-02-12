package config

import (
	"os"
	"gopkg.in/yaml.v3"
)

type Profile struct {
	Metadata struct {
		UnitID string `yaml:"unit_id"`
		Tenant string `yaml:"tenant"`
	} `yaml:"metadata"`
	Capabilities []struct {
		Subject string `yaml:"subject"`
		Allow   []string `yaml:"allow"` // z.B. ["pub", "sub"]
	} `yaml:"capabilities"`
}

// IsAllowed prüft, ob eine Aktion auf einem Subject erlaubt ist
func (p *Profile) IsAllowed(subject string, action string) bool {
	for _, cap := range p.Capabilities {
		if cap.Subject == subject {
			for _, a := range cap.Allow {
				if a == action {
					return true
				}
			}
		}
	}
	// Spezialfall: Heartbeats erlauben wir intern immer (oder wir fügen sie der YAML hinzu)
	if subject == "ops.heartbeat."+p.Metadata.UnitID {
		return true
	}
	return false
}

func Load(path string) (*Profile, error) {
	f, err := os.ReadFile(path)
	if err != nil { return nil, err }
	var p Profile
	err = yaml.Unmarshal(f, &p)
	return &p, err
}
