package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/porkbun"
	provider2 "github.com/go-acme/lego/v5/providers/dns/poweradmin"
	provider3 "github.com/go-acme/lego/v5/providers/dns/rackspace"
	provider4 "github.com/go-acme/lego/v5/providers/dns/rage4"
	provider5 "github.com/go-acme/lego/v5/providers/dns/rainyun"
	provider6 "github.com/go-acme/lego/v5/providers/dns/rcodezero"
	provider7 "github.com/go-acme/lego/v5/providers/dns/regfish"
)

var factories = map[string]func() (challenge.Provider, error){
	"porkbun": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"poweradmin": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"rackspace": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"rage4": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"rainyun": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"rcodezero": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"regfish": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
