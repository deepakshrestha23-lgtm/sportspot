import json
from decimal import Decimal, ROUND_HALF_UP
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings


class KhaltiConfigurationError(Exception):
    pass


class KhaltiAPIError(Exception):
    pass


def is_khalti_configured():
    return bool(settings.KHALTI_SECRET_KEY)


def initiate_khalti_payment(booking):
    if not is_khalti_configured():
        raise KhaltiConfigurationError("Payment is temporarily unavailable. Please try again later.")

    amount_paisa = npr_to_paisa(booking.amount)
    if amount_paisa < 1000:
        raise KhaltiAPIError("Khalti requires a minimum payment amount of Rs 10.")

    return_url = build_return_url(booking)
    payload = {
        "return_url": return_url,
        "website_url": settings.KHALTI_WEBSITE_URL,
        "amount": amount_paisa,
        "purchase_order_id": booking.booking_code,
        "purchase_order_name": f"{booking.venue.name} - {booking.court.name}",
        "customer_info": {
            "name": booking.player.full_name,
            "email": booking.player.email,
            "phone": booking.player.phone,
        },
    }
    return khalti_post("epayment/initiate/", payload)


def lookup_khalti_payment(pidx):
    if not is_khalti_configured():
        raise KhaltiConfigurationError("Payment is temporarily unavailable. Please try again later.")
    if not pidx:
        raise KhaltiAPIError("Khalti PIDX is missing.")
    return khalti_post("epayment/lookup/", {"pidx": pidx})


def npr_to_paisa(amount):
    decimal_amount = Decimal(str(amount))
    return int((decimal_amount * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def build_return_url(booking):
    frontend_url = settings.FRONTEND_URL.rstrip("/")
    return_path = settings.KHALTI_RETURN_PATH
    if not return_path.startswith("/"):
        return_path = f"/{return_path}"
    separator = "&" if "?" in return_path else "?"
    return f"{frontend_url}{return_path}{separator}booking_id={booking.id}"


def khalti_post(path, payload):
    base_url = settings.KHALTI_BASE_URL.rstrip("/")
    url = f"{base_url}/{path.lstrip('/')}"
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Authorization": f"Key {settings.KHALTI_SECRET_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raise KhaltiAPIError(parse_error_response(error)) from error
    except URLError as error:
        raise KhaltiAPIError("Could not connect to Khalti. Please try again.") from error
    except json.JSONDecodeError as error:
        raise KhaltiAPIError("Khalti returned an invalid response.") from error


def parse_error_response(error):
    try:
        data = json.loads(error.read().decode("utf-8"))
    except Exception:
        return f"Khalti request failed with HTTP {error.code}."

    if isinstance(data, dict):
        detail = data.get("detail") or data.get("message") or data
        return detail if isinstance(detail, str) else json.dumps(detail)
    return f"Khalti request failed with HTTP {error.code}."
