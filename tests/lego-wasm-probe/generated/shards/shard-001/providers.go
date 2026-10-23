package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/abion"
	provider2 "github.com/go-acme/lego/v5/providers/dns/acmedns"
	provider3 "github.com/go-acme/lego/v5/providers/dns/active24"
	provider4 "github.com/go-acme/lego/v5/providers/dns/alidns"
	provider5 "github.com/go-acme/lego/v5/providers/dns/aliesa"
	provider6 "github.com/go-acme/lego/v5/providers/dns/allinkl"
	provider7 "github.com/go-acme/lego/v5/providers/dns/alwaysdata"
)

var factories = map[string]func() (challenge.Provider, error){
	"abion": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"acmedns": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"active24": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"alidns": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"aliesa": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"allinkl": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"alwaysdata": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
