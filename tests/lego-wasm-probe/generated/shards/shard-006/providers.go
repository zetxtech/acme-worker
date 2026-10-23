package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/czechia"
	provider2 "github.com/go-acme/lego/v5/providers/dns/dandomain"
	provider3 "github.com/go-acme/lego/v5/providers/dns/ddnss"
	provider4 "github.com/go-acme/lego/v5/providers/dns/derak"
	provider5 "github.com/go-acme/lego/v5/providers/dns/desec"
	provider6 "github.com/go-acme/lego/v5/providers/dns/designate"
	provider7 "github.com/go-acme/lego/v5/providers/dns/digitalocean"
)

var factories = map[string]func() (challenge.Provider, error){
	"czechia": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"dandomain": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"ddnss": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"derak": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"desec": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"designate": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"digitalocean": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
