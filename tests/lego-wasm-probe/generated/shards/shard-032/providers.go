package main

import (
	provider1 "github.com/go-acme/lego/v5/providers/dns/zilore"
	provider2 "github.com/go-acme/lego/v5/providers/dns/zoneedit"
	provider3 "github.com/go-acme/lego/v5/providers/dns/zoneee"
	provider4 "github.com/go-acme/lego/v5/providers/dns/zonomi"
)

var factories = [...]any{
	provider1.NewDNSProvider,
	provider2.NewDNSProvider,
	provider3.NewDNSProvider,
	provider4.NewDNSProvider,
}
