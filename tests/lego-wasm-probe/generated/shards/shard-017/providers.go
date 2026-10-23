package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/liquidweb"
	provider2 "github.com/go-acme/lego/v5/providers/dns/loopia"
	provider3 "github.com/go-acme/lego/v5/providers/dns/luadns"
	provider4 "github.com/go-acme/lego/v5/providers/dns/mailinabox"
	provider5 "github.com/go-acme/lego/v5/providers/dns/manageengine"
	provider6 "github.com/go-acme/lego/v5/providers/dns/metaname"
	provider7 "github.com/go-acme/lego/v5/providers/dns/metaregistrar"
)

var factories = map[string]func() (challenge.Provider, error){
	"liquidweb": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"loopia": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"luadns": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"mailinabox": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"manageengine": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"metaname": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"metaregistrar": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
