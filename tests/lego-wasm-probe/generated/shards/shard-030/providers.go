package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/westcn"
	provider2 "github.com/go-acme/lego/v5/providers/dns/xinnet"
	provider3 "github.com/go-acme/lego/v5/providers/dns/yandex"
	provider4 "github.com/go-acme/lego/v5/providers/dns/yandex360"
	provider5 "github.com/go-acme/lego/v5/providers/dns/yandexcloud"
	provider6 "github.com/go-acme/lego/v5/providers/dns/zilore"
	provider7 "github.com/go-acme/lego/v5/providers/dns/zoneedit"
)

var factories = map[string]func() (challenge.Provider, error){
	"westcn": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"xinnet": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"yandex": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"yandex360": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"yandexcloud": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"zilore": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"zoneedit": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
