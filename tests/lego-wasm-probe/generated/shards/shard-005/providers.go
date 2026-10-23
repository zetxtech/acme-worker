package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/connbyte"
	provider2 "github.com/go-acme/lego/v5/providers/dns/conoha"
	provider3 "github.com/go-acme/lego/v5/providers/dns/conohav3"
	provider4 "github.com/go-acme/lego/v5/providers/dns/constellix"
	provider5 "github.com/go-acme/lego/v5/providers/dns/corenetworks"
	provider6 "github.com/go-acme/lego/v5/providers/dns/cpanel"
	provider7 "github.com/go-acme/lego/v5/providers/dns/curanet"
)

var factories = map[string]func() (challenge.Provider, error){
	"connbyte": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"conoha": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"conohav3": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"constellix": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"corenetworks": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"cpanel": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"curanet": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
