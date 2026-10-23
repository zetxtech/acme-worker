package main

import "testing"

func TestFactoryRegistry(t *testing.T) {
	if len(factories) != 2 {
		t.Fatalf("factory count = %d, want 2", len(factories))
	}
	for name, factory := range factories {
		if factory == nil {
			t.Fatalf("factory %s is nil", name)
		}
	}
}
