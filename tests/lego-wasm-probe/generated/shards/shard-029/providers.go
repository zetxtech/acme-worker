package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/vultr"
	provider2 "github.com/go-acme/lego/v5/providers/dns/wannafind"
	provider3 "github.com/go-acme/lego/v5/providers/dns/webglobe"
	provider4 "github.com/go-acme/lego/v5/providers/dns/webnamesca"
	provider5 "github.com/go-acme/lego/v5/providers/dns/webnamesru"
	provider6 "github.com/go-acme/lego/v5/providers/dns/websupport"
	provider7 "github.com/go-acme/lego/v5/providers/dns/wedos"
)

var factories = map[string]func() (challenge.Provider, error){
	"vultr": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"wannafind": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"webglobe": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"webnamesca": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"webnamesru": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"websupport": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"wedos": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
