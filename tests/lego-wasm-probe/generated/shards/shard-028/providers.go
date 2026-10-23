package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/vercel"
	provider2 "github.com/go-acme/lego/v5/providers/dns/versio"
	provider3 "github.com/go-acme/lego/v5/providers/dns/vinyldns"
	provider4 "github.com/go-acme/lego/v5/providers/dns/virtualname"
	provider5 "github.com/go-acme/lego/v5/providers/dns/vkcloud"
	provider6 "github.com/go-acme/lego/v5/providers/dns/volcengine"
	provider7 "github.com/go-acme/lego/v5/providers/dns/vscale"
)

var factories = map[string]func() (challenge.Provider, error){
	"vercel": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"versio": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"vinyldns": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"virtualname": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"vkcloud": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"volcengine": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"vscale": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
