package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/namedotcom"
	provider2 "github.com/go-acme/lego/v5/providers/dns/namesilo"
	provider3 "github.com/go-acme/lego/v5/providers/dns/namesurfer"
	provider4 "github.com/go-acme/lego/v5/providers/dns/nearlyfreespeech"
	provider5 "github.com/go-acme/lego/v5/providers/dns/nederhost"
	provider6 "github.com/go-acme/lego/v5/providers/dns/neodigit"
	provider7 "github.com/go-acme/lego/v5/providers/dns/netcup"
)

var factories = map[string]func() (challenge.Provider, error){
	"namedotcom": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"namesilo": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"namesurfer": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"nearlyfreespeech": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"nederhost": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"neodigit": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"netcup": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
