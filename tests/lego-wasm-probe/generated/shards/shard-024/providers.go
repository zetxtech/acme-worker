package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/regru"
	provider2 "github.com/go-acme/lego/v5/providers/dns/rimuhosting"
	provider3 "github.com/go-acme/lego/v5/providers/dns/safedns"
	provider4 "github.com/go-acme/lego/v5/providers/dns/sakuracloud"
	provider5 "github.com/go-acme/lego/v5/providers/dns/scaleway"
	provider6 "github.com/go-acme/lego/v5/providers/dns/scannet"
	provider7 "github.com/go-acme/lego/v5/providers/dns/selectel"
)

var factories = map[string]func() (challenge.Provider, error){
	"regru": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"rimuhosting": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"safedns": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"sakuracloud": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"scaleway": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"scannet": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"selectel": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
