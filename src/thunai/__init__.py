"""
thun.ai — Edge-First In-Vehicle Intelligence System (IVIS)
"""

from importlib.metadata import version, PackageNotFoundError

try:
    __version__ = version("thunai")
except PackageNotFoundError:
    __version__ = "0.1.0"

__all__ = ["__version__"]
