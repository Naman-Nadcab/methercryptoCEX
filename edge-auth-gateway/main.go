package main

import (
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"time"
)

func main() {
	backendURL := "http://localhost:4000"
	client := &http.Client{Timeout: 30 * time.Second}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sessionID := ""
		if c, err := r.Cookie("session_id"); err == nil && c != nil {
			sessionID = c.Value
		}
		requestID := uuidV4()

		targetURL := backendURL + r.URL.Path
		if r.URL.RawQuery != "" {
			targetURL += "?" + r.URL.RawQuery
		}

		var body io.Reader = r.Body
		if r.Body == nil {
			body = nil
		}
		outReq, err := http.NewRequest(r.Method, targetURL, body)
		if err != nil {
			http.Error(w, "Bad Gateway", 502)
			return
		}
		if r.ContentLength >= 0 {
			outReq.ContentLength = r.ContentLength
		}
		if r.TransferEncoding != nil {
			outReq.TransferEncoding = r.TransferEncoding
		}

		for k, v := range r.Header {
			for _, vv := range v {
				outReq.Header.Add(k, vv)
			}
		}
		outReq.Header.Set("X-Session-Id", sessionID)
		outReq.Header.Set("X-Request-Id", requestID)

		res, err := client.Do(outReq)
		if err != nil {
			http.Error(w, "Bad Gateway", 502)
			return
		}
		defer res.Body.Close()

		latencyMs := time.Since(start).Milliseconds()
		w.Header().Set("X-Edge-Latency-Ms", fmt.Sprintf("%d", latencyMs))
		for k, v := range res.Header {
			for _, vv := range v {
				w.Header().Add(k, vv)
			}
		}
		w.WriteHeader(res.StatusCode)
		io.Copy(w, res.Body)
		if latencyMs > 50 {
			fmt.Printf("[SLOW] edge %d ms %s %s\n", latencyMs, r.Method, r.URL.Path)
		}
	})

	srv := &http.Server{
		Addr:         ":3001",
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}
	srv.ListenAndServe()
}

func uuidV4() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%12x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
