package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/mijnhost"
	provider2 "github.com/go-acme/lego/v5/providers/dns/mittwald"
	provider3 "github.com/go-acme/lego/v5/providers/dns/myaddr"
	provider4 "github.com/go-acme/lego/v5/providers/dns/mydnsjp"
	provider5 "github.com/go-acme/lego/v5/providers/dns/myra"
	provider6 "github.com/go-acme/lego/v5/providers/dns/mythicbeasts"
	provider7 "github.com/go-acme/lego/v5/providers/dns/namecheap"
)

var factories = map[string]func() (challenge.Provider, error){
	"mijnhost": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"mittwald": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"myaddr": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"mydnsjp": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"myra": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"mythicbeasts": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"namecheap": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
