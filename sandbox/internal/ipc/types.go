// Package ipc implements the JSON-RPC 2.0 protocol over Unix sockets
// for the DaShengOS sandbox daemon. Mirrors the DeerFlow daemon pattern
// (see /Users/apple/Desktop/ai-workbench-v2/deerflow/daemon.py).
package ipc

import (
	"encoding/json"
	"fmt"
)

// JSON-RPC 2.0 spec — https://www.jsonrpc.org/specification
// (mirrors the wire format used by the Python DeerFlow daemon)

const (
	Version = "2.0"

	// Standard JSON-RPC error codes
	ErrParse          = -32700
	ErrInvalidRequest = -32600
	ErrMethodNotFound = -32601
	ErrInvalidParams  = -32602
	ErrInternal       = -32603
)

// Request is a JSON-RPC 2.0 request.
type Request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// Response is a JSON-RPC 2.0 response.
type Response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  interface{}     `json:"result,omitempty"`
	Error   *Error          `json:"error,omitempty"`
}

// Error is a JSON-RPC 2.0 error object.
type Error struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

func (e *Error) Error() string {
	return fmt.Sprintf("jsonrpc error %d: %s", e.Code, e.Message)
}

// NewError builds a JSON-RPC error response value.
func NewError(id json.RawMessage, code int, message string, data ...interface{}) *Response {
	e := &Error{Code: code, Message: message}
	if len(data) > 0 {
		e.Data = data[0]
	}
	return &Response{JSONRPC: Version, ID: id, Error: e}
}

// Handler is a method handler. params is the raw JSON; the handler is
// responsible for unmarshalling into its own typed struct.
type Handler func(params json.RawMessage) (interface{}, error)

// Registry maps method name → handler. The server dispatches requests
// to handlers via the registry.
type Registry struct {
	handlers map[string]Handler
}

func NewRegistry() *Registry {
	return &Registry{handlers: make(map[string]Handler)}
}

func (r *Registry) Register(method string, h Handler) {
	r.handlers[method] = h
}

func (r *Registry) Dispatch(req *Request) *Response {
	if req.JSONRPC != Version {
		return NewError(req.ID, ErrInvalidRequest, "jsonrpc must be \"2.0\"")
	}
	if req.Method == "" {
		return NewError(req.ID, ErrInvalidRequest, "method is required")
	}
	h, ok := r.handlers[req.Method]
	if !ok {
		return NewError(req.ID, ErrMethodNotFound, fmt.Sprintf("method not found: %s", req.Method))
	}
	result, err := h(req.Params)
	if err != nil {
		return NewError(req.ID, ErrInternal, err.Error())
	}
	return &Response{JSONRPC: Version, ID: req.ID, Result: result}
}

func (r *Registry) Methods() []string {
	out := make([]string, 0, len(r.handlers))
	for k := range r.handlers {
		out = append(out, k)
	}
	return out
}
