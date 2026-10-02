#!/usr/bin/env python3
# Test server for run-nested-art.sh. Usage: artserver.py PORT DIR

import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

port = int(sys.argv[1])
root = Path(sys.argv[2])
hits = {}
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with lock:
            n = hits[self.path] = hits.get(self.path, 0) + 1
        print(f'SERVER {time.strftime("%H:%M:%S")} {self.path} hit {n}', flush=True)

        if self.path == '/flaky.png' and n == 1:
            self.send_error(500)
            return
        if self.path == '/hang.png' and n == 1 or self.path == '/gone.png':
            time.sleep(60)
            return
        if 'missing' in self.path:
            self.send_error(404)
            return
        if 'slow' in self.path:
            time.sleep(1.5)

        wide = 'wide' in self.path or 'hang' in self.path
        data = (root / ('np-cover-wide.png' if wide else 'np-art-square.png')).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
print(f'SERVER listening {port}', flush=True)
server.serve_forever()
