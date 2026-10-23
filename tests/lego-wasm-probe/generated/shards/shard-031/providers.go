package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/zoneee"
	provider2 "github.com/go-acme/lego/v5/providers/dns/zonomi"
)

var factories = map[string]func() (challenge.Provider, error){
	"zoneee": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"zonomi": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
}
