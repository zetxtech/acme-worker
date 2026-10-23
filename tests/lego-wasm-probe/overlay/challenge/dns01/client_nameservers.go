package dns01

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/miekg/dns"
)

const maxDoHResponseBytes int64 = 64 * 1024

var dohPropagationHTTPClient = &http.Client{Timeout: 4 * time.Second}

type dohPropagationAnswer struct {
	Type uint16 `json:"type"`
	Data string `json:"data"`
}

type dohPropagationMessage struct {
	Status int                    `json:"Status"`
	Answer []dohPropagationAnswer `json:"Answer"`
}

func (c *Client) checkRecursiveNameserversPropagation(ctx context.Context, fqdn, value string) (bool, error) {
	return c.checkNameserversPropagationCustom(ctx, fqdn, value, nil, false, true)
}

func (c *Client) checkAuthoritativeNameserversPropagation(ctx context.Context, fqdn, value string) (bool, error) {
	return c.checkNameserversPropagationCustom(ctx, fqdn, value, nil, false, true)
}

func (c *Client) checkNameserversPropagationCustom(ctx context.Context, fqdn, value string, nameservers []string, addPort, recursive bool) (bool, error) {
	_, _, _ = nameservers, addPort, recursive
	checkCtx, cancel := context.WithTimeout(ctx, 9*time.Second)
	defer cancel()

	for _, endpoint := range []string{"https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"} {
		message, err := queryTXTOverDoH(checkCtx, endpoint, fqdn)
		if err != nil {
			return false, err
		}
		if message.Status != 0 && message.Status != 3 {
			return false, fmt.Errorf("DoH returned DNS status %d for %s", message.Status, fqdn)
		}

		found := false
		for _, answer := range message.Answer {
			if answer.Type != dns.TypeTXT {
				continue
			}
			record := joinTXTChunks(answer.Data)
			if record == value {
				found = true
			}
		}
		if !found {
			return false, fmt.Errorf("DoH resolver did not return the expected TXT value")
		}
	}

	return true, nil
}

func queryTXTOverDoH(ctx context.Context, endpoint, name string) (*dohPropagationMessage, error) {
	query := url.Values{"name": {name}, "type": {"TXT"}}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/dns-json")

	response, err := dohPropagationHTTPClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("DoH propagation query failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("DoH propagation query returned HTTP %d", response.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxDoHResponseBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxDoHResponseBytes {
		return nil, fmt.Errorf("DoH response exceeded %d bytes", maxDoHResponseBytes)
	}

	var message dohPropagationMessage
	if err := json.Unmarshal(body, &message); err != nil {
		return nil, fmt.Errorf("invalid DoH JSON response: %w", err)
	}
	return &message, nil
}

func joinTXTChunks(value string) string {
	record, err := dns.NewRR("_acme-challenge.example. 60 IN TXT " + value)
	if err != nil {
		return ""
	}
	text, ok := record.(*dns.TXT)
	if !ok {
		return ""
	}
	joined := ""
	for _, chunk := range text.Txt {
		joined += chunk
	}
	return joined
}
