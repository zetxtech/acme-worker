package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/openprovider"
	provider2 "github.com/go-acme/lego/v5/providers/dns/opusdns"
	provider3 "github.com/go-acme/lego/v5/providers/dns/otc"
	provider4 "github.com/go-acme/lego/v5/providers/dns/ovh"
	provider5 "github.com/go-acme/lego/v5/providers/dns/pdns"
	provider6 "github.com/go-acme/lego/v5/providers/dns/plesk"
	provider7 "github.com/go-acme/lego/v5/providers/dns/pointdns"
)

var factories = map[string]func() (challenge.Provider, error){
	"openprovider": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"opusdns": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"otc": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"ovh": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"pdns": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"plesk": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"pointdns": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
