package main

import dnsproviders "github.com/go-acme/lego/v4/providers/dns"

func main() {
	_, _ = dnsproviders.NewDNSChallengeProviderByName("cloudflare")
}
