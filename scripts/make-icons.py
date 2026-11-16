#!/usr/bin/env python3
"""Render build/icon.svg to build/icons/<N>x<N>.png and build/icon.png (uses system librsvg via PyGObject)."""
import os
import gi
gi.require_version('Rsvg', '2.0')
from gi.repository import Rsvg  # noqa: E402
import cairo  # noqa: E402

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build')
handle = Rsvg.Handle.new_from_file(os.path.join(root, 'icon.svg'))
os.makedirs(os.path.join(root, 'icons'), exist_ok=True)


def render(size, out):
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, size, size)
    ctx = cairo.Context(surf)
    rect = Rsvg.Rectangle()
    rect.x = rect.y = 0
    rect.width = rect.height = size
    handle.render_document(ctx, rect)
    surf.write_to_png(out)


for s in (16, 24, 32, 48, 64, 128, 256, 512):
    render(s, os.path.join(root, 'icons', f'{s}x{s}.png'))
render(1024, os.path.join(root, 'icon.png'))
print('icons written')
