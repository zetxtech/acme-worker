package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/selectelv2"
	provider2 "github.com/go-acme/lego/v5/providers/dns/selfhostde"
	provider3 "github.com/go-acme/lego/v5/providers/dns/servercow"
	provider4 "github.com/go-acme/lego/v5/providers/dns/shellrent"
	provider5 "github.com/go-acme/lego/v5/providers/dns/simply"
	provider6 "github.com/go-acme/lego/v5/providers/dns/sonic"
	provider7 "github.com/go-acme/lego/v5/providers/dns/spaceship"
)

var factories = map[string]func() (challenge.Provider, error){
	"selectelv2": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"selfhostde": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"servercow": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"shellrent": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"simply": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"sonic": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"spaceship": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
