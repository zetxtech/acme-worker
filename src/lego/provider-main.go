package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"strings"
	"syscall/js"
	"time"

	"github.com/go-acme/lego/v5/challenge"
	"github.com/go-acme/lego/v5/challenge/dns01"
	legolog "github.com/go-acme/lego/v5/log"
)

type challengeInput struct {
	Domain           string `json:"domain"`
	Token            string `json:"token"`
	KeyAuthorization string `json:"keyAuthorization"`
}

type groupInput struct {
	Provider   string            `json:"provider"`
	Env        map[string]string `json:"env"`
	Zones      []string          `json:"zones"`
	Challenges []challengeInput  `json:"challenges"`
}

type lifecycleInput struct {
	Groups []groupInput `json:"groups"`
}

type activeRecord struct {
	Provider  challenge.Provider
	Group     groupInput
	Challenge challengeInput
}

func withEnv(values map[string]string, operation func() error) error {
	previous := map[string]*string{}
	defer func() {
		for name, value := range previous {
			if value == nil {
				_ = os.Unsetenv(name)
			} else {
				_ = os.Setenv(name, *value)
			}
		}
	}()
	for name, value := range values {
		if original, found := os.LookupEnv(name); found {
			copyValue := original
			previous[name] = &copyValue
		} else {
			previous[name] = nil
		}
		if err := os.Setenv(name, value); err != nil {
			return err
		}
	}
	return operation()
}

func withinScope(fqdn string, zones []string) bool {
	name := strings.TrimSuffix(strings.ToLower(fqdn), ".")
	name = strings.TrimPrefix(name, "_acme-challenge.")
	for _, zone := range zones {
		if name == zone || strings.HasSuffix(name, "."+zone) {
			return true
		}
	}
	return false
}

func awaitValidation(records []map[string]string) error {
	encoded, _ := json.Marshal(records)
	finished := make(chan bool, 1)
	success := js.FuncOf(func(this js.Value, args []js.Value) any { finished <- true; return nil })
	failure := js.FuncOf(func(this js.Value, args []js.Value) any { finished <- false; return nil })
	defer success.Release()
	defer failure.Release()
	js.Global().Call("legoValidate", string(encoded)).Call("then", success, failure)
	if !<-finished {
		return fmt.Errorf("validation failed")
	}
	return nil
}

func execute() {
	log.SetOutput(io.Discard)
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	legolog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stage := "input"
	active := []activeRecord{}
	ok := false
	defer func() {
		if recover() != nil {
			stage = "panic"
		}
		js.Global().Set("legoPhase", "cleanup")
		cleanupOK := true
		for index := len(active) - 1; index >= 0; index-- {
			record := active[index]
			cleaned := false
			for attempt := 0; attempt < 2 && !cleaned; attempt++ {
				func() {
					defer func() {
						if recover() != nil {
							cleaned = false
						}
					}()
					ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
					defer cancel()
					cleaned = withEnv(record.Group.Env, func() error {
						return record.Provider.CleanUp(ctx, record.Challenge.Domain, record.Challenge.Token, record.Challenge.KeyAuthorization)
					}) == nil
				}()
			}
			cleanupOK = cleanupOK && cleaned
		}
		encoded, _ := json.Marshal(map[string]any{"ok": ok, "cleanupOk": cleanupOK, "stage": stage, "runtimeVersion": "v5.5.2"})
		js.Global().Set("legoResult", string(encoded))
	}()
	var input lifecycleInput
	if json.Unmarshal([]byte(js.Global().Get("legoInput").String()), &input) != nil || len(input.Groups) > 20 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	records := []map[string]string{}
	for _, group := range input.Groups {
		factory := factories[group.Provider]
		if factory == nil {
			return
		}
		var provider challenge.Provider
		stage = "credentials"
		err := withEnv(group.Env, func() error { var factoryErr error; provider, factoryErr = factory(); return factoryErr })
		if err != nil {
			return
		}
		for _, item := range group.Challenges {
			stage = "present"
			info := dns01.GetChallengeInfo(ctx, item.Domain, item.KeyAuthorization)
			if !withinScope(info.EffectiveFQDN, group.Zones) {
				stage = "scope"
				return
			}
			err = withEnv(group.Env, func() error { return provider.Present(ctx, item.Domain, item.Token, item.KeyAuthorization) })
			if err != nil {
				return
			}
			active = append(active, activeRecord{Provider: provider, Group: group, Challenge: item})
			records = append(records, map[string]string{"fqdn": info.EffectiveFQDN, "value": info.Value})
		}
	}
	stage = "validation"
	if awaitValidation(records) != nil {
		return
	}
	stage = "complete"
	ok = true
}

func main() { execute() }
