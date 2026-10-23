package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/netlify"
	provider2 "github.com/go-acme/lego/v5/providers/dns/netnod"
	provider3 "github.com/go-acme/lego/v5/providers/dns/nexdns"
	provider4 "github.com/go-acme/lego/v5/providers/dns/ngenix"
	provider5 "github.com/go-acme/lego/v5/providers/dns/nicmanager"
	provider6 "github.com/go-acme/lego/v5/providers/dns/nicru"
	provider7 "github.com/go-acme/lego/v5/providers/dns/nifcloud"
)

var factories = map[string]func() (challenge.Provider, error){
	"netlify": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"netnod": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"nexdns": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"ngenix": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"nicmanager": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"nicru": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"nifcloud": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
