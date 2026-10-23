package main

import (
	"github.com/go-acme/lego/v5/challenge"
	provider1 "github.com/go-acme/lego/v5/providers/dns/httpreq"
	provider2 "github.com/go-acme/lego/v5/providers/dns/huaweicloud"
	provider3 "github.com/go-acme/lego/v5/providers/dns/hurricane"
	provider4 "github.com/go-acme/lego/v5/providers/dns/ibmcloud"
	provider5 "github.com/go-acme/lego/v5/providers/dns/iijdpf"
	provider6 "github.com/go-acme/lego/v5/providers/dns/infoblox"
	provider7 "github.com/go-acme/lego/v5/providers/dns/infomaniak"
)

var factories = map[string]func() (challenge.Provider, error){
	"httpreq": func() (challenge.Provider, error) { return provider1.NewDNSProvider() },
	"huaweicloud": func() (challenge.Provider, error) { return provider2.NewDNSProvider() },
	"hurricane": func() (challenge.Provider, error) { return provider3.NewDNSProvider() },
	"ibmcloud": func() (challenge.Provider, error) { return provider4.NewDNSProvider() },
	"iijdpf": func() (challenge.Provider, error) { return provider5.NewDNSProvider() },
	"infoblox": func() (challenge.Provider, error) { return provider6.NewDNSProvider() },
	"infomaniak": func() (challenge.Provider, error) { return provider7.NewDNSProvider() },
}
