"""Local dev server: no caching (ES module edits show up on reload) and HTTP Range
support (browsers need it to seek inside videos; plain `python -m http.server` has none).

Usage: python tools/serve.py [port]   (default 8000)
"""

import functools
import http.server
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class DevHandler(http.server.SimpleHTTPRequestHandler):
    def handle(self):
        # Browsers drop video range requests while seeking; that is not an error.
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
            pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        path = self.translate_path(self.path)
        if not match or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        start = int(match[1]) if match[1] else max(0, size - int(match[2] or 0))
        end = int(match[2]) if match[1] and match[2] else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_error(416, "Requested range not satisfiable")
            return None
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self.range_left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, "range_left", None)
        if left is None:
            return super().copyfile(source, outputfile)
        while left > 0:
            chunk = source.read(min(left, 64 * 1024))
            if not chunk:
                break
            outputfile.write(chunk)
            left -= len(chunk)
        self.range_left = None


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = functools.partial(DevHandler, directory=str(ROOT))
    print(f"Earth Jukebox on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
