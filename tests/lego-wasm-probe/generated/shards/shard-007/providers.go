package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/dinahosting"
	provider2 "github.com/go-acme/lego/v5/providers/dns/directadmin"
	provider3 "github.com/go-acme/lego/v5/providers/dns/dns51"
	provider4 "github.com/go-acme/lego/v5/providers/dns/dnscale"
	provider5 "github.com/go-acme/lego/v5/providers/dns/dnsexit"
	provider6 "github.com/go-acme/lego/v5/providers/dns/dnshomede"
	provider7 "github.com/go-acme/lego/v5/providers/dns/dnsimple"
)

var factories = map[string]func() (challenge.Provider, error){
	"dinahosting": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"directadmin": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"dns51": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"dnscale": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"dnsexit": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"dnshomede": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"dnsimple": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
