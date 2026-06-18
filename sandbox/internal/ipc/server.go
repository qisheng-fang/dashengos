package ipc

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/dashengos/sandbox/internal/handlers"
)

// Server is a Unix-socket JSON-RPC 2.0 server with a configurable
// worker pool. Each connection is handled by a single worker goroutine;
// the worker reads newline-delimited JSON-RPC requests and writes
// newline-delimited responses.
type Server struct {
	socketPath string
	listener   net.Listener
	registry   *Registry
	workers    int
	wg         sync.WaitGroup

	// shuttingDown is closed to signal the accept loop to exit.
	shuttingDown chan struct{}
}

type Options struct {
	SocketPath string
	Workers    int
	Logger     *log.Logger
}

func NewServer(reg *Registry, opts Options) *Server {
	if opts.SocketPath == "" {
		opts.SocketPath = "/tmp/dasheng/sandbox.sock"
	}
	if opts.Workers <= 0 {
		opts.Workers = 8
	}
	if opts.Logger == nil {
		opts.Logger = log.New(os.Stderr, "[sandbox] ", log.LstdFlags|log.Lmicroseconds)
	}
	return &Server{
		socketPath:   opts.SocketPath,
		registry:     reg,
		workers:      opts.Workers,
		shuttingDown: make(chan struct{}),
	}
}

// Listen creates the Unix socket and starts accepting connections.
// Blocks until Shutdown is called.
func (s *Server) Listen() error {
	if err := os.MkdirAll(filepath.Dir(s.socketPath), 0o755); err != nil {
		return fmt.Errorf("mkdir socket dir: %w", err)
	}
	// Remove stale socket file (e.g. from a crashed previous run)
	_ = os.Remove(s.socketPath)

	l, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return fmt.Errorf("listen %s: %w", s.socketPath, err)
	}
	s.listener = l
	s.logger().Printf("listening on unix://%s (workers=%d, methods=%d)",
		s.socketPath, s.workers, len(s.registry.Methods()))

	// Channel to accept from; close on shutdown
	conns := make(chan net.Conn, s.workers)
	s.wg.Add(s.workers)
	for i := 0; i < s.workers; i++ {
		go s.workerLoop(conns)
	}

	go func() {
		for {
			conn, err := l.Accept()
			if err != nil {
				select {
				case <-s.shuttingDown:
					close(conns)
					return
				default:
					s.logger().Printf("accept error: %v", err)
					continue
				}
			}
			conns <- conn
		}
	}()

	// Block until shutdown
	<-s.shuttingDown
	return nil
}

func (s *Server) workerLoop(conns <-chan net.Conn) {
	defer s.wg.Done()
	for c := range conns {
		s.handleConn(c)
	}
}

func (s *Server) handleConn(c net.Conn) {
	defer c.Close()
	defer handlers.GlobalMetrics.ConnClosed()
	handlers.GlobalMetrics.ConnOpened()
	reader := bufio.NewReaderSize(c, 64*1024)
	writer := bufio.NewWriterSize(c, 64*1024)
	for {
		line, err := readLine(reader, 30*time.Second)
		if err != nil {
			if err != io.EOF {
				s.logger().Printf("conn read: %v", err)
			}
			return
		}
		var req Request
		if err := json.Unmarshal(line, &req); err != nil {
			resp := NewError(nil, ErrParse, "invalid JSON: "+err.Error())
			writeResp(writer, resp)
			continue
		}
		s.logger().Printf("→ %s (id=%s)", req.Method, string(req.ID))
		start := time.Now()
		resp := s.registry.Dispatch(&req)
		latencyUs := time.Since(start).Microseconds()
		isErr := resp.Error != nil
		handlers.GlobalMetrics.RecordCall(req.Method, latencyUs, isErr)
		writeResp(writer, resp)
	}
}

func writeResp(w *bufio.Writer, resp *Response) {
	b, _ := json.Marshal(resp)
	b = append(b, '\n')
	w.Write(b)
	w.Flush()
}

// readLine reads a single newline-delimited line, with a per-read timeout.
func readLine(r *bufio.Reader, timeout time.Duration) ([]byte, error) {
	type result struct {
		line []byte
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		line, err := r.ReadBytes('\n')
		ch <- result{line, err}
	}()
	select {
	case r := <-ch:
		return r.line, r.err
	case <-time.After(timeout):
		return nil, fmt.Errorf("read timeout after %s", timeout)
	}
}

// Shutdown stops accepting new connections and waits for workers to finish.
func (s *Server) Shutdown() {
	close(s.shuttingDown)
	if s.listener != nil {
		s.listener.Close()
	}
	s.wg.Wait()
	os.Remove(s.socketPath)
}

func (s *Server) logger() *log.Logger { return defaultLogger }

var defaultLogger = log.New(os.Stderr, "[sandbox] ", log.LstdFlags|log.Lmicroseconds)
