package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"syscall/js"
	"time"

	"github.com/go-acme/lego/v5/providers/dns/alidns"
	"github.com/go-acme/lego/v5/providers/dns/azuredns"
	"github.com/go-acme/lego/v5/providers/dns/cloudflare"
	"github.com/go-acme/lego/v5/providers/dns/digitalocean"
	"github.com/go-acme/lego/v5/providers/dns/gcloud"
	"github.com/go-acme/lego/v5/providers/dns/route53"
	"github.com/go-acme/lego/v5/providers/dns/tencentcloud"
)

var factories = [...]any{
	alidns.NewDNSProvider,
	azuredns.NewDNSProvider,
	cloudflare.NewDNSProvider,
	tencentcloud.NewDNSProvider,
	digitalocean.NewDNSProvider,
	gcloud.NewDNSProvider,
	route53.NewDNSProvider,
}

type fixtureTransport struct {
	created bool
	deleted bool
	queries int
}

func (fixture *fixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	body := ""
	switch {
	case request.URL.Host == "cloudflare-dns.com" || request.URL.Host == "dns.google":
		fixture.queries++
		body = `{"Status":0,"Answer":[]}`
		if request.URL.Query().Get("name") == "example.com." {
			body = `{"Status":0,"Answer":[{"name":"example.com.","type":6,"TTL":60,"data":"ns.example.com. hostmaster.example.com. 1 1 1 1 60"}]}`
		}
	case request.URL.Path == "/zones":
		body = `{"success":true,"result":[{"id":"fixture-zone","name":"example.com"}],"result_info":{"page":1,"total_pages":1}}`
	case request.Method == http.MethodPost && request.URL.Path == "/zones/fixture-zone/dns_records":
		fixture.created = true
		body = `{"success":true,"result":{"id":"fixture-owned-record"}}`
	case request.Method == http.MethodDelete && request.URL.Path == "/zones/fixture-zone/dns_records/fixture-owned-record":
		fixture.deleted = fixture.created
		body = `{"success":true,"result":{"id":"fixture-owned-record"}}`
	default:
		return nil, fmt.Errorf("unexpected fixture request: %s %s", request.Method, request.URL.Path)
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
}

func main() {
	fixture := &fixtureTransport{}
	http.DefaultTransport = fixture
	result := map[string]any{"providerCount": len(factories), "runtimeVersion": "v5.5.2", "synthetic": true}

	_ = os.Setenv("CLOUDFLARE_DNS_API_TOKEN", "fixture-only-token")
	_ = os.Setenv("CLOUDFLARE_BASE_URL", "https://provider.fixture")
	_ = os.Setenv("LEGO_DISABLE_CNAME_SUPPORT", "true")
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	provider, err := cloudflare.NewDNSProvider()
	result["cloudflareProviderReady"] = err == nil
	if err == nil {
		err = provider.Present(ctx, "example.com", "fixture-token", "fixture-key-authorization")
	}
	if err != nil {
		result["cloudflarePresentError"] = err.Error()
	} else if err = provider.CleanUp(ctx, "example.com", "fixture-token", "fixture-key-authorization"); err != nil {
		result["cloudflareCleanupError"] = err.Error()
	}
	result["presented"] = fixture.created
	result["cleanedSameRecord"] = fixture.deleted
	result["dohQueries"] = fixture.queries
	result["ok"] = err == nil && fixture.created && fixture.deleted && fixture.queries > 0

	encoded, _ := json.Marshal(result)
	js.Global().Set("legoProbeResult", string(encoded))
}
