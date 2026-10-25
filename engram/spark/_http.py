"""One small HTTP POST helper shared by the intent client and the local whisper client.

Redirects are never followed: a 3xx comes back as its status code, so a moved or
hijacked endpoint cannot forward a request (and its Authorization header) elsewhere.
Replies are read up to a fixed size.
"""

from __future__ import annotations

import urllib.error
import urllib.request

MAX_REPLY_BYTES = 256 * 1024


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401, ANN001
        return None  # do not follow; urllib then raises HTTPError with the 3xx code


def opener(use_env_proxies: bool = True) -> urllib.request.OpenerDirector:
    handlers: list[urllib.request.BaseHandler] = [_NoRedirect()]
    if not use_env_proxies:
        handlers.append(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener(*handlers)


def post(url: str, body: bytes, headers: dict[str, str], timeout_s: float,
         use_env_proxies: bool = True) -> tuple[int, bytes]:
    """Returns (status, body). Raises OSError subclasses (timeouts, refused connections) as urllib does."""
    req = urllib.request.Request(url, body, headers, method="POST")
    try:
        with opener(use_env_proxies).open(req, timeout=timeout_s) as r:
            data = r.read(MAX_REPLY_BYTES + 1)
            status = r.status
    except urllib.error.HTTPError as e:
        e.close()
        return e.code, b""
    if len(data) > MAX_REPLY_BYTES:
        raise ValueError("reply too large")
    return status, data
