package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/joker"
	provider2 "github.com/go-acme/lego/v5/providers/dns/katapult"
	provider3 "github.com/go-acme/lego/v5/providers/dns/keyhelp"
	provider4 "github.com/go-acme/lego/v5/providers/dns/leaseweb"
	provider5 "github.com/go-acme/lego/v5/providers/dns/liara"
	provider6 "github.com/go-acme/lego/v5/providers/dns/limacity"
	provider7 "github.com/go-acme/lego/v5/providers/dns/linode"
)

var factories = map[string]func() (challenge.Provider, error){
	"joker": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"katapult": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"keyhelp": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"leaseweb": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"liara": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"limacity": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"linode": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
