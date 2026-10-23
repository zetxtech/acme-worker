package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/exoscale"
	provider2 "github.com/go-acme/lego/v5/providers/dns/f5xc"
	provider3 "github.com/go-acme/lego/v5/providers/dns/feno"
	provider4 "github.com/go-acme/lego/v5/providers/dns/fornex"
	provider5 "github.com/go-acme/lego/v5/providers/dns/freemyip"
	provider6 "github.com/go-acme/lego/v5/providers/dns/gandi"
	provider7 "github.com/go-acme/lego/v5/providers/dns/gandiv5"
)

var factories = map[string]func() (challenge.Provider, error){
	"exoscale": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"f5xc": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"feno": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"fornex": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"freemyip": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"gandi": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"gandiv5": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
