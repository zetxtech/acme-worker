package main

import "testing"

func TestFactoryRegistry(t *testing.T) {
	if len(factories) != 4 {
		t.Fatalf("factory count = %d, want 4", len(factories))
	}
	for index, factory := range factories {
		if factory == nil {
			t.Fatalf("factory %d is nil", index)
		}
	}
}
