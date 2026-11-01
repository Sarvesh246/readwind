import importlib.util
import io
import json
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("indexes", Path(__file__).resolve().parents[1] / "scripts/catalog/index-gutenberg.py")
indexes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexes)


class BulkMetadataTests(unittest.TestCase):
    def archive(self, path, record_id="1", ebook_id="1"):
        payload = f'<pgterms:ebook rdf:about="ebooks/{ebook_id}"><dcterms:rights>Public domain in the USA.</dcterms:rights></pgterms:ebook>'.encode()
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode="w") as tar:
            item = tarfile.TarInfo(f"cache/epub/{record_id}/pg{record_id}.rdf")
            item.size = len(payload)
            tar.addfile(item, io.BytesIO(payload))
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("rdf-files.tar", stream.getvalue())

    def test_rights_are_bound_to_ebook_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "feed.zip"
            self.archive(path)
            self.assertEqual(indexes.rights_index(path)["rights"], {"1": "Public domain in the USA."})
            self.archive(path, ebook_id="2")
            with self.assertRaises(ValueError):
                indexes.rights_index(path)

    def test_rejects_unexpected_archive_members_without_extracting_paths(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "feed.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("../outside", "not metadata")
            with self.assertRaises(ValueError):
                indexes.rights_index(path)
            self.assertFalse((Path(folder).parent / "outside").exists())


if __name__ == "__main__":
    unittest.main()
