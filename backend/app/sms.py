"""Provider-neutral SMS delivery for school contact verification.

The configured webhook is an administrator-controlled integration endpoint.
Applicants never supply or override the destination phone number.
"""
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def send_schoolbridge_sms(phone: str, message: str) -> bool:
    endpoint = (os.getenv("SCHOOLBRIDGE_SMS_WEBHOOK_URL") or "").strip()
    if not endpoint:
        return False

    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        return False

    payload = json.dumps({"to": phone, "message": message}).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    token = (os.getenv("SCHOOLBRIDGE_SMS_WEBHOOK_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = Request(endpoint, data=payload, headers=headers, method="POST")
    try:
        with urlopen(request, timeout=10) as response:
            return 200 <= response.status < 300
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        return False
