"""Index official bulk metadata without extracting archive paths to disk."""
import argparse
import csv
import gzip
import hashlib
import html
import json
import re
import tarfile
import time
import zipfile
from pathlib import Path


def rights_index(path):
    rights = {}
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) != 1 or members[0].filename != "rdf-files.tar" or members[0].file_size > 3_000_000_000:
            raise ValueError("Unexpected Gutenberg RDF archive layout or size")
        with archive.open(members[0]) as stream, tarfile.open(fileobj=stream, mode="r|") as records:
            count = 0
            for member in records:
                match = re.search(r"(?:^|/)pg(\d+)\.rdf$", member.name)
                if not match or not member.isfile():
                    continue
                count += 1
                if count > 200_000 or member.size > 2_000_000:
                    raise ValueError("RDF inventory exceeds limits")
                text = records.extractfile(member).read().decode("utf-8")
                if not re.search(r'<pgterms:ebook\b[^>]*rdf:about="ebooks/' + match[1] + r'"', text):
                    raise ValueError("RDF record identity does not match its file")
                license_text = re.search(r"<dcterms:rights>([^<]+)</dcterms:rights>", text)
                if license_text:
                    rights[match[1]] = html.unescape(license_text[1])
    return {"source": "https://www.gutenberg.org/cache/epub/feeds/rdf-files.tar.zip", "rights": rights}


def cover_index(path):
    covers = set()
    with gzip.open(path, "rt", encoding="utf-8", newline="") as stream:
        for count, row in enumerate(csv.reader(stream)):
            if count > 5_000_000:
                raise ValueError("Image inventory exceeds limits")
            if len(row) < 8 or not re.fullmatch(r"\d+", row[0]):
                continue
            if not re.search("cover", row[2] + " " + row[3], re.I):
                continue
            if re.search(r"(?:^|[/_])\d+-cover\.(?:png|jpe?g)$", row[3], re.I):
                continue
            try:
                width, height = int(row[5]), int(row[6])
            except ValueError:
                continue
            if width >= 224 and height >= 300 and .3 <= width / height <= 1.2:
                covers.add(row[0])
    return {"source": "https://www.gutenberg.org/cache/epub/feeds/img_data.csv.gz", "ids": sorted(covers, key=int)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["rights", "covers"])
    parser.add_argument("archive", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = rights_index(args.archive) if args.kind == "rights" else cover_index(args.archive)
    with args.archive.open("rb") as stream:
        result["sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
    result["indexedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(result), encoding="utf-8")
    temporary.replace(args.output)
    print("Indexed", len(result.get("rights", result.get("ids", []))), "records")
