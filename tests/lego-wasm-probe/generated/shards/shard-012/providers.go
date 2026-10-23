package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/gcore"
	provider2 "github.com/go-acme/lego/v5/providers/dns/gehirn"
	provider3 "github.com/go-acme/lego/v5/providers/dns/gigahostno"
	provider4 "github.com/go-acme/lego/v5/providers/dns/glesys"
	provider5 "github.com/go-acme/lego/v5/providers/dns/gname"
	provider6 "github.com/go-acme/lego/v5/providers/dns/godaddy"
	provider7 "github.com/go-acme/lego/v5/providers/dns/gravity"
)

var factories = map[string]func() (challenge.Provider, error){
	"gcore": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"gehirn": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"gigahostno": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"glesys": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"gname": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"godaddy": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"gravity": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
