package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/stackpath"
	provider2 "github.com/go-acme/lego/v5/providers/dns/syse"
	provider3 "github.com/go-acme/lego/v5/providers/dns/technitium"
	provider4 "github.com/go-acme/lego/v5/providers/dns/tele3"
	provider5 "github.com/go-acme/lego/v5/providers/dns/tencentcloud"
	provider6 "github.com/go-acme/lego/v5/providers/dns/timewebcloud"
	provider7 "github.com/go-acme/lego/v5/providers/dns/todaynic"
)

var factories = map[string]func() (challenge.Provider, error){
	"stackpath": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"syse": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"technitium": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"tele3": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"tencentcloud": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"timewebcloud": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"todaynic": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
