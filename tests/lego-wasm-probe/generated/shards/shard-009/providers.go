package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/duckdns"
	provider2 "github.com/go-acme/lego/v5/providers/dns/dyn"
	provider3 "github.com/go-acme/lego/v5/providers/dns/dynadot"
	provider4 "github.com/go-acme/lego/v5/providers/dns/dyndnsfree"
	provider5 "github.com/go-acme/lego/v5/providers/dns/dynu"
	provider6 "github.com/go-acme/lego/v5/providers/dns/easydns"
	provider7 "github.com/go-acme/lego/v5/providers/dns/edgecenter"
)

var factories = map[string]func() (challenge.Provider, error){
	"duckdns": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"dyn": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"dynadot": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"dyndnsfree": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"dynu": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"easydns": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"edgecenter": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
