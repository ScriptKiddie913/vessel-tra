import sys
import os

# Ensure the repo root is on the path so server.py can be imported
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import app  # noqa: F401 - Vercel uses this module-level `app`
