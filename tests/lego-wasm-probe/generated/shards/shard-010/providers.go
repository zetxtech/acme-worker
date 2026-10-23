package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/edgedns"
	provider2 "github.com/go-acme/lego/v5/providers/dns/edgeone"
	provider3 "github.com/go-acme/lego/v5/providers/dns/efficientip"
	provider4 "github.com/go-acme/lego/v5/providers/dns/epik"
	provider5 "github.com/go-acme/lego/v5/providers/dns/eurodns"
	provider6 "github.com/go-acme/lego/v5/providers/dns/euserv"
	provider7 "github.com/go-acme/lego/v5/providers/dns/excedo"
)

var factories = map[string]func() (challenge.Provider, error){
	"edgedns": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"edgeone": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"efficientip": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"epik": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"eurodns": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"euserv": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"excedo": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
