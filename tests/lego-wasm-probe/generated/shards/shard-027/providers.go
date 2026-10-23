package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/transip"
	provider2 "github.com/go-acme/lego/v5/providers/dns/ucloud"
	provider3 "github.com/go-acme/lego/v5/providers/dns/ultradns"
	provider4 "github.com/go-acme/lego/v5/providers/dns/uniteddomains"
	provider5 "github.com/go-acme/lego/v5/providers/dns/variomedia"
	provider6 "github.com/go-acme/lego/v5/providers/dns/veesp"
	provider7 "github.com/go-acme/lego/v5/providers/dns/vegadns"
)

var factories = map[string]func() (challenge.Provider, error){
	"transip": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"ucloud": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"ultradns": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"uniteddomains": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"variomedia": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"veesp": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"vegadns": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
