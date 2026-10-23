package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/baiducloud"
	provider2 "github.com/go-acme/lego/v5/providers/dns/beget"
	provider3 "github.com/go-acme/lego/v5/providers/dns/binarylane"
	provider4 "github.com/go-acme/lego/v5/providers/dns/bindman"
	provider5 "github.com/go-acme/lego/v5/providers/dns/bluecat"
	provider6 "github.com/go-acme/lego/v5/providers/dns/bluecatv2"
	provider7 "github.com/go-acme/lego/v5/providers/dns/bookmyname"
)

var factories = map[string]func() (challenge.Provider, error){
	"baiducloud": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"beget": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"binarylane": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"bindman": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"bluecat": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"bluecatv2": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"bookmyname": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
