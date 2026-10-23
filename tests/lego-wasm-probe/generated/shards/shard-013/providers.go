package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/hetzner"
	provider2 "github.com/go-acme/lego/v5/providers/dns/hostingde"
	provider3 "github.com/go-acme/lego/v5/providers/dns/hostinger"
	provider4 "github.com/go-acme/lego/v5/providers/dns/hostingnl"
	provider5 "github.com/go-acme/lego/v5/providers/dns/hosttech"
	provider6 "github.com/go-acme/lego/v5/providers/dns/hostup"
	provider7 "github.com/go-acme/lego/v5/providers/dns/httpnet"
)

var factories = map[string]func() (challenge.Provider, error){
	"hetzner": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"hostingde": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"hostinger": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"hostingnl": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"hosttech": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"hostup": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"httpnet": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
