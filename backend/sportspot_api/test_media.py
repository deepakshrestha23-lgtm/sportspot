from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.files.storage import default_storage
from django.test import SimpleTestCase, override_settings


class PublicImageTests(SimpleTestCase):
    def test_private_verification_documents_are_not_public_media(self):
        response = self.client.get("/media/venues/documents/identity.pdf")

        self.assertEqual(response.status_code, 404)

    def test_local_team_photo_can_be_read_through_media_route(self):
        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root, USE_S3_MEDIA=False):
                photo_path = Path(media_root) / "team_photos" / "test.png"
                photo_path.parent.mkdir(parents=True)
                photo_path.write_bytes(b"fake-png")

                response = self.client.get("/media/team_photos/test.png")

                self.assertEqual(response.status_code, 200)
                self.assertEqual(response["Content-Type"], "image/png")
                response.close()
