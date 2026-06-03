#!/usr/bin/env python3
"""
Martini Mapper desktop CLI.

Usage:
    python app.py [--input molecule.sdf] [--mapping rules.json]
                  [--output-gro ligand.gro] [--output-itp ligand.itp]
                  [--output-ndx mapping.ndx] [--output-json bead-mapping.json]

Requires the app to be built first:
    quasar build
"""

import argparse
import http.server
import os
import socket
import sys
import threading
import urllib.parse
import webview

DIST_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist", "spa")
)


class SpaHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the Quasar SPA; fall back to index.html for unknown paths."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def log_message(self, fmt, *args):  # suppress request logs
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        fs_path = os.path.join(DIST_DIR, parsed.path.lstrip("/"))
        if not os.path.isfile(fs_path):
            self.path = "/index.html"
        super().do_GET()


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Api:
    """Methods exposed to the web app via window.pywebview.api.*"""

    def __init__(
        self, sdf_path: str | None, mapping_path: str | None, outputs: dict[str, str]
    ):
        self._sdf_path = os.path.abspath(sdf_path) if sdf_path else None
        self._mapping_path = os.path.abspath(mapping_path) if mapping_path else None
        self._outputs = outputs

    def get_initial_sdf(self):
        if self._sdf_path and os.path.isfile(self._sdf_path):
            with open(self._sdf_path) as f:
                return f.read()
        return None

    def get_initial_mapping(self):
        if self._mapping_path and os.path.isfile(self._mapping_path):
            with open(self._mapping_path) as f:
                return f.read()
        return None

    def save_file(self, file_type: str, content: str):
        path = self._outputs.get(file_type)
        if not path:
            print(f'Warning: no output path configured for type "{file_type}"')
            return False
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w") as f:
            f.write(content)
        print(f"Saved: {os.path.abspath(path)}")
        return True


def main():
    parser = argparse.ArgumentParser(
        description="Martini Mapper — interactive CG bead-mapping tool"
    )
    parser.add_argument(
        "--input", "-i", metavar="SDF", help="SDF file to load on startup"
    )
    parser.add_argument(
        "--mapping",
        "-m",
        metavar="JSON",
        help="Bead-type mapping rules JSON to load on startup",
    )
    parser.add_argument(
        "--output-gro",
        metavar="FILE",
        default="ligand.gro",
        help="Output .gro file (default: ligand.gro)",
    )
    parser.add_argument(
        "--output-itp",
        metavar="FILE",
        default="ligand.itp",
        help="Output .itp file (default: ligand.itp)",
    )
    parser.add_argument(
        "--output-ndx",
        metavar="FILE",
        default="mapping.ndx",
        help="Output .ndx file (default: mapping.ndx)",
    )
    parser.add_argument(
        "--output-json",
        metavar="FILE",
        default="bead-mapping.json",
        help="Output mapping .json file (default: bead-mapping.json)",
    )
    args = parser.parse_args()

    if not os.path.isdir(DIST_DIR):
        print(f"Error: built app not found at {DIST_DIR}")
        print('Run "quasar build" first.')
        sys.exit(1)

    outputs = {
        "gro": args.output_gro,
        "itp": args.output_itp,
        "ndx": args.output_ndx,
        "json": args.output_json,
    }

    port = _free_port()
    server = http.server.HTTPServer(("127.0.0.1", port), SpaHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    api = Api(args.input, args.mapping, outputs)
    webview.create_window(
        "Martini Mapper",
        url=f"http://127.0.0.1:{port}",
        js_api=api,
        width=1400,
        height=900,
        min_size=(800, 600),
    )
    webview.start()
    server.shutdown()


if __name__ == "__main__":
    main()
