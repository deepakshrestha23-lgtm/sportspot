import mimetypes
from pathlib import PurePosixPath

from django.conf import settings
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404, HttpResponseRedirect
from django.views.decorators.http import require_GET


# These prefixes contain images intentionally shown in public player/team and
# venue surfaces. Verification documents are deliberately excluded.
PUBLIC_IMAGE_PREFIXES = (
    "team_photos/",
    "player_profiles/",
    "venues/photos/",
    "venues/gallery/",
    "venues/courts/",
)
PUBLIC_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}


@require_GET
def public_image(request, media_path):
    """Serve public images through the configured Django storage backend.

    S3 deployments receive a short redirect to a signed object URL. Local
    development and older Beanstalk environments stream the same image from
    their configured filesystem storage instead of returning a production 404.
    Private verification documents never match this route.
    """
    normalized_path = str(media_path).lstrip("/")
    path = PurePosixPath(normalized_path)

    if (
        normalized_path != path.as_posix()
        or any(part in {"", ".", ".."} for part in path.parts)
        or not normalized_path.startswith(PUBLIC_IMAGE_PREFIXES)
        or path.suffix.lower() not in PUBLIC_IMAGE_EXTENSIONS
    ):
        raise Http404

    if not default_storage.exists(normalized_path):
        raise Http404

    if getattr(settings, "USE_S3_MEDIA", False):
        return HttpResponseRedirect(default_storage.url(normalized_path))

    content_type = mimetypes.guess_type(normalized_path)[0] or "application/octet-stream"
    response = FileResponse(default_storage.open(normalized_path, "rb"), content_type=content_type)
    response["Cache-Control"] = "public, max-age=300"
    return response
