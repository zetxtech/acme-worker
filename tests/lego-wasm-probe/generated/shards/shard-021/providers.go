package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/njalla"
	provider2 "github.com/go-acme/lego/v5/providers/dns/nodion"
	provider3 "github.com/go-acme/lego/v5/providers/dns/ns1"
	provider4 "github.com/go-acme/lego/v5/providers/dns/octenium"
	provider5 "github.com/go-acme/lego/v5/providers/dns/omglol"
	provider6 "github.com/go-acme/lego/v5/providers/dns/onecloudru"
	provider7 "github.com/go-acme/lego/v5/providers/dns/onlinenet"
)

var factories = map[string]func() (challenge.Provider, error){
	"njalla": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"nodion": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"ns1": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"octenium": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"omglol": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"onecloudru": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"onlinenet": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
