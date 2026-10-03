"""The lock on the admin page: one shared password, known to the two of us.

Nothing here knows the password. The server holds only a salted scrypt hash of
it (`ADMIN_PASSWORD_HASH`), made by running this file:

    uv run python -m app.services.admin_gate

which asks for the password without echoing it and prints the line to paste
into the host's environment. The right password is exchanged for a short-lived
signed token; every admin endpoint asks for that token (`deps.require_admin`).

The signing key is derived from the hash, so changing the password signs
everyone out. With no hash configured the admin side is simply closed.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from ..config import settings

#: How long an unlock lasts.
SESSION_S = 8 * 3600
MIN_PASSWORD = 12

# scrypt cost: ~16 MB and a few tens of milliseconds per check — slow enough to
# make guessing pointless next to the attempt limit, light enough for a small
# instance. Changing these needs a new hash.
_N, _R, _P, _LEN = 2**14, 8, 1, 32


def _derive(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_N, r=_R, p=_P, dklen=_LEN)


def hash_password(password: str) -> str:
    """`scrypt:<salt>:<hash>` — what goes in `ADMIN_PASSWORD_HASH`."""
    salt = secrets.token_bytes(16)
    return f"scrypt:{salt.hex()}:{_derive(password, salt).hex()}"


def configured() -> bool:
    return settings.admin_password_hash.strip().startswith("scrypt:")


def verify_password(password: str) -> bool:
    """Whether `password` is the admin password. Constant-time on the compare."""
    try:
        _, salt_hex, want_hex = settings.admin_password_hash.strip().split(":")
        salt, want = bytes.fromhex(salt_hex), bytes.fromhex(want_hex)
    except ValueError:
        return False
    return hmac.compare_digest(_derive(password, salt), want)


def _key() -> bytes:
    material = f"{settings.admin_password_hash.strip()}|{settings.supabase_jwt_secret}"
    return hashlib.sha256(b"space-learn-admin|" + material.encode("utf-8")).digest()


def _sign(expires: int) -> str:
    return hmac.new(_key(), str(expires).encode("ascii"), hashlib.sha256).hexdigest()


def issue_token(now: float | None = None) -> tuple[str, int]:
    """A token good for `SESSION_S`, and when it stops being good (epoch seconds)."""
    expires = int(now if now is not None else time.time()) + SESSION_S
    return f"{expires}.{_sign(expires)}", expires


def check_token(token: str | None, now: float | None = None) -> bool:
    if not token or not configured():
        return False
    expires_text, _, signature = token.partition(".")
    if not expires_text.isdigit() or len(expires_text) > 12:
        return False
    expires = int(expires_text)
    if expires < (now if now is not None else time.time()):
        return False
    return hmac.compare_digest(_sign(expires), signature)


if __name__ == "__main__":  # pragma: no cover - a helper run by hand
    import getpass

    first = getpass.getpass("New admin password: ")
    if len(first) < MIN_PASSWORD:
        raise SystemExit(f"Use at least {MIN_PASSWORD} characters.")
    if first != getpass.getpass("Again: "):
        raise SystemExit("Those didn't match.")
    print("\nSet this on the server (Render → Environment), and in .env for local use:\n")
    print(f"ADMIN_PASSWORD_HASH={hash_password(first)}")
