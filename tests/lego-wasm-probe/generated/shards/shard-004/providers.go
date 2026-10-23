package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/checkdomain"
	provider2 "github.com/go-acme/lego/v5/providers/dns/civo"
	provider3 "github.com/go-acme/lego/v5/providers/dns/clouddns"
	provider4 "github.com/go-acme/lego/v5/providers/dns/cloudflare"
	provider5 "github.com/go-acme/lego/v5/providers/dns/cloudns"
	provider6 "github.com/go-acme/lego/v5/providers/dns/cloudru"
	provider7 "github.com/go-acme/lego/v5/providers/dns/com35"
)

var factories = map[string]func() (challenge.Provider, error){
	"checkdomain": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"civo": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"clouddns": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"cloudflare": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"cloudns": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"cloudru": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"com35": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
