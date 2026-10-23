package internal

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
)

const maxDoHResponseBytes int64 = 64 * 1024

var dohHTTPClient = &http.Client{Timeout: 4 * time.Second}
var dohCNAMECache sync.Map

type dohAnswer struct {
	Name string `json:"name"`
	Type uint16 `json:"type"`
	TTL  uint32 `json:"TTL"`
	Data string `json:"data"`
}

type dohMessage struct {
	Status int         `json:"Status"`
	Answer []dohAnswer `json:"Answer"`
}

func (c *Client) FindZoneByFqdn(ctx context.Context, fqdn string) (string, error) {
	return c.FindZoneByFqdnCustom(ctx, fqdn, c.recursiveNameservers)
}

func (c *Client) FindZoneByFqdnCustom(ctx context.Context, fqdn string, nameservers []string) (string, error) {
	_ = nameservers
	if len(fqdn) == 0 || len(fqdn) > 253 {
		return "", fmt.Errorf("invalid fqdn length")
	}

	lookupCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	soa, err := c.lookupSoaByFqdn(lookupCtx, fqdn, nil)
	if err != nil {
		return "", fmt.Errorf("[fqdn=%s] %w", fqdn, err)
	}

	return soa.zone, nil
}

func (c *Client) lookupSoaByFqdn(ctx context.Context, fqdn string, nameservers []string) (*soaCacheEntry, error) {
	_ = nameservers
	c.muFqdnSoaCache.Lock()
	defer c.muFqdnSoaCache.Unlock()

	if entry := c.fqdnSoaCache[fqdn]; entry != nil && !entry.isExpired() {
		return entry, nil
	}

	entry, err := c.fetchSoaByFqdn(ctx, fqdn, nil)
	if err != nil {
		return nil, err
	}

	c.fqdnSoaCache[fqdn] = entry
	return entry, nil
}

func (c *Client) fetchSoaByFqdn(ctx context.Context, fqdn string, nameservers []string) (*soaCacheEntry, error) {
	_ = nameservers
	labels := strings.Split(strings.TrimSuffix(strings.TrimSpace(fqdn), "."), ".")
	if len(labels) == 0 || labels[0] == "" {
		return nil, fmt.Errorf("could not find the start of authority for %q", fqdn)
	}

	var lastErr error
	for offset := 0; offset < len(labels)-1 && offset < 16; offset++ {
		candidate := strings.Join(labels[offset:], ".") + "."
		message, err := queryDoH(ctx, candidate, dns.TypeSOA)
		if err != nil {
			lastErr = err
			continue
		}
		if message.Status == 3 {
			continue
		}
		if message.Status != 0 {
			lastErr = fmt.Errorf("DoH returned DNS status %d for %s", message.Status, candidate)
			continue
		}

		containsCNAME := false
		for _, answer := range message.Answer {
			if answer.Type == dns.TypeCNAME {
				containsCNAME = true
				break
			}
		}
		if containsCNAME {
			continue
		}
		for _, answer := range message.Answer {
			if answer.Type != dns.TypeSOA {
				continue
			}

			zone := strings.ToLower(answer.Name)
			if !strings.HasSuffix(zone, ".") {
				zone += "."
			}
			if !strings.EqualFold(strings.TrimSuffix(candidate, "."), strings.TrimSuffix(zone, ".")) {
				lastErr = fmt.Errorf("DoH SOA owner did not match queried name %s", candidate)
				continue
			}

			primaryNameserver := ""
			if fields := strings.Fields(answer.Data); len(fields) > 0 {
				primaryNameserver = fields[0]
			}
			ttl := answer.TTL
			if ttl == 0 {
				ttl = 60
			}
			if ttl > 3600 {
				ttl = 3600
			}

			return &soaCacheEntry{zone: zone, primaryNs: primaryNameserver,
				expires: time.Now().Add(time.Duration(ttl) * time.Second)}, nil
		}
	}

	if lastErr != nil {
		return nil, fmt.Errorf("could not find the start of authority for %q: %w", fqdn, lastErr)
	}
	return nil, fmt.Errorf("could not find the start of authority for %q", fqdn)
}

func queryDoH(ctx context.Context, name string, recordType uint16) (*dohMessage, error) {
	if _, valid := dns.IsDomainName(name); !valid || len(name) > 254 {
		return nil, fmt.Errorf("invalid DNS name")
	}
	cacheKey := strings.ToLower(name)
	if recordType == dns.TypeCNAME {
		if cached, found := dohCNAMECache.Load(cacheKey); found {
			return cached.(*dohMessage), nil
		}
	}
	var lastErr error
	for _, endpoint := range []string{"https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"} {
		message, err := queryDoHEndpoint(ctx, endpoint, name, recordType)
		if err == nil {
			if recordType == dns.TypeCNAME {
				dohCNAMECache.Store(cacheKey, message)
			}
			return message, nil
		}
		lastErr = err
	}
	return nil, fmt.Errorf("bounded DoH query failed: %w", lastErr)
}

func queryDoHEndpoint(ctx context.Context, endpoint, name string, recordType uint16) (*dohMessage, error) {
	query := url.Values{"name": {name}, "type": {fmt.Sprint(recordType)}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/dns-json")

	response, err := dohHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("DoH returned HTTP %d", response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxDoHResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxDoHResponseBytes {
		return nil, fmt.Errorf("DoH response exceeded %d bytes", maxDoHResponseBytes)
	}

	var message dohMessage
	if err := json.Unmarshal(body, &message); err != nil {
		return nil, fmt.Errorf("invalid DoH JSON response: %w", err)
	}
	if len(message.Answer) > 128 {
		return nil, fmt.Errorf("DoH answer count exceeded limit")
	}
	return &message, nil
}
