from datetime import timedelta
from pathlib import Path
import os

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-key-change-me")
DEBUG = os.getenv("DEBUG", "False").lower() == "true"

ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("ALLOWED_HOSTS", "127.0.0.1,localhost").split(",")
    if host.strip()
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "accounts",
    "players",
    "teams",
    "matchmaking",
    "team_challenges",
    "notifications",
    "venues",
    "wishlists",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "sportspot_api.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "sportspot_api.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME", "sportspot_db"),
        "USER": os.getenv("DB_USER", "postgres"),
        "PASSWORD": os.getenv("DB_PASSWORD", "postgres"),
        "HOST": os.getenv("DB_HOST", "127.0.0.1"),
        "PORT": os.getenv("DB_PORT", "5432"),
        # Keeping the test database separate makes it safe to run the suite
        # without Django ever creating or dropping the development database.
        "TEST": {
            "NAME": os.getenv("TEST_DB_NAME", "test_sportspot_db"),
            "USER": os.getenv("TEST_DB_USER", os.getenv("DB_USER", "postgres")),
            "PASSWORD": os.getenv("TEST_DB_PASSWORD", os.getenv("DB_PASSWORD", "postgres")),
            "HOST": os.getenv("TEST_DB_HOST", os.getenv("DB_HOST", "127.0.0.1")),
            "PORT": os.getenv("TEST_DB_PORT", os.getenv("DB_PORT", "5432")),
        },
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kathmandu"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.User"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "accounts.authentication.VerifiedJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.AllowAny",
    ),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
KHALTI_BASE_URL = os.getenv("KHALTI_BASE_URL", "https://dev.khalti.com/api/v2")
KHALTI_SECRET_KEY = os.getenv("KHALTI_SECRET_KEY", "")
KHALTI_WEBSITE_URL = os.getenv("KHALTI_WEBSITE_URL", FRONTEND_URL)
KHALTI_RETURN_PATH = os.getenv(
    "KHALTI_RETURN_PATH",
    "/dashboard/player/bookings/payment/khalti-return",
)
EMAIL_BACKEND = os.getenv(
    "EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend",
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True").lower() == "true"
EMAIL_USE_SSL = os.getenv("EMAIL_USE_SSL", "False").lower() == "true"
EMAIL_TIMEOUT = int(os.getenv("EMAIL_TIMEOUT", "10"))
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "SportSpot <no-reply@sportspot.local>")
SPORTSPOT_SUPPORT_EMAIL = os.getenv("SPORTSPOT_SUPPORT_EMAIL", "support@sportspot.local")
ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS = os.getenv(
    "ACCOUNT_RECOVERY_REVEAL_EMAIL_ERRORS",
    "True" if DEBUG else "False",
).lower() == "true"

if EMAIL_USE_TLS and EMAIL_USE_SSL:
    raise ValueError("EMAIL_USE_TLS and EMAIL_USE_SSL cannot both be enabled.")
CORS_ALLOWED_ORIGINS = list(dict.fromkeys(
    [
        FRONTEND_URL.rstrip("/"),
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ]
    + [
        origin.strip().rstrip("/")
        for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    ]
))

# Local browsers sometimes open the frontend through the computer's private
# network address. Keep this development-only convenience out of production.
if DEBUG:
    CORS_ALLOWED_ORIGIN_REGEXES = [
        r"^https?://localhost:\d+$",
        r"^https?://127\.0\.0\.1:\d+$",
        r"^https?://10(?:\.\d{1,3}){3}:\d+$",
        r"^https?://172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}:\d+$",
        r"^https?://192\.168(?:\.\d{1,3}){2}:\d+$",
    ]

