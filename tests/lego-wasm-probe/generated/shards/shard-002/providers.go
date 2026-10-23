package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/anexia"
	provider2 "github.com/go-acme/lego/v5/providers/dns/artfiles"
	provider3 "github.com/go-acme/lego/v5/providers/dns/arvancloud"
	provider4 "github.com/go-acme/lego/v5/providers/dns/auroradns"
	provider5 "github.com/go-acme/lego/v5/providers/dns/autodns"
	provider6 "github.com/go-acme/lego/v5/providers/dns/axelname"
	provider7 "github.com/go-acme/lego/v5/providers/dns/azion"
)

var factories = map[string]func() (challenge.Provider, error){
	"anexia": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"artfiles": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"arvancloud": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"auroradns": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"autodns": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"axelname": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"azion": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
