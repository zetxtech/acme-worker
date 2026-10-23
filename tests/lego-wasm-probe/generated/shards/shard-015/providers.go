package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/inwx"
	provider2 "github.com/go-acme/lego/v5/providers/dns/ionos"
	provider3 "github.com/go-acme/lego/v5/providers/dns/ionoscloud"
	provider4 "github.com/go-acme/lego/v5/providers/dns/ipv64"
	provider5 "github.com/go-acme/lego/v5/providers/dns/ispconfig"
	provider6 "github.com/go-acme/lego/v5/providers/dns/ispconfigddns"
	provider7 "github.com/go-acme/lego/v5/providers/dns/jdcloud"
)

var factories = map[string]func() (challenge.Provider, error){
	"inwx": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"ionos": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"ionoscloud": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"ipv64": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"ispconfig": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"ispconfigddns": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"jdcloud": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
