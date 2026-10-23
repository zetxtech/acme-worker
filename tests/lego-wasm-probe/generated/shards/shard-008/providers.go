package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/dnsla"
	provider2 "github.com/go-acme/lego/v5/providers/dns/dnsmadeeasy"
	provider3 "github.com/go-acme/lego/v5/providers/dns/dnsmint"
	provider4 "github.com/go-acme/lego/v5/providers/dns/dnsservices"
	provider5 "github.com/go-acme/lego/v5/providers/dns/dode"
	provider6 "github.com/go-acme/lego/v5/providers/dns/domeneshop"
	provider7 "github.com/go-acme/lego/v5/providers/dns/dreamhost"
)

var factories = map[string]func() (challenge.Provider, error){
	"dnsla": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"dnsmadeeasy": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"dnsmint": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"dnsservices": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"dode": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"domeneshop": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"dreamhost": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
