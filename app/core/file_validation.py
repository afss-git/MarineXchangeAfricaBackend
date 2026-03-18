"""
File upload validation utilities.

Validates file content via magic bytes (file signatures) rather than
trusting the client-supplied Content-Type header, which is trivially spoofed.
"""
from __future__ import annotations

# Magic byte signatures for allowed file types
_MAGIC_SIGNATURES: dict[str, list[bytes]] = {
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/webp": [b"RIFF"],  # RIFF....WEBP — checked with secondary validation
    "application/pdf": [b"%PDF"],
}


def validate_magic_bytes(content: bytes, claimed_mime: str) -> bool:
    """
    Verify that the file's magic bytes match the claimed MIME type.

    Returns True if the file content starts with the expected signature
    for the given MIME type, or if the MIME type has no registered signature.
    """
    sigs = _MAGIC_SIGNATURES.get(claimed_mime)
    if sigs is None:
        # No signature registered — allow (caller is responsible for MIME whitelist)
        return True

    for sig in sigs:
        if content[:len(sig)] == sig:
            # Extra check for WebP: bytes 8-12 must be "WEBP"
            if claimed_mime == "image/webp":
                return len(content) >= 12 and content[8:12] == b"WEBP"
            return True

    return False
