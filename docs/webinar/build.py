#!/usr/bin/env python3
"""Builds the webinar page: inlines screenshots as data URIs.

  python3 docs/webinar/build.py <image_dir>
Outputs docs/webinar/Webinar_KasirWarung_AI.html (artifact page, no <html> skeleton)
and docs/webinar/_print.html (full document used to render the PDF).
"""
import base64, os, sys
here = os.path.dirname(os.path.abspath(__file__))
img_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'img')
src = open(os.path.join(here, 'webinar.src.html'), encoding='utf-8').read()
for key, name in [('IMG_DESKTOP', 'desktop.jpg'), ('IMG_KASIR', 'kasir.jpg'), ('IMG_SUCCESS', 'success.jpg'), ('IMG_DASH', 'dash.jpg'), ('IMG_KASBON', 'kasbon.jpg')]:
    data = base64.b64encode(open(os.path.join(img_dir, name), 'rb').read()).decode()
    src = src.replace('{{' + key + '}}', 'data:image/jpeg;base64,' + data)
assert '{{' not in src
open(os.path.join(here, 'Webinar_KasirWarung_AI.html'), 'w', encoding='utf-8').write(src)
doc = ('<!doctype html><html lang="id"><head><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
       '<style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
       '</head><body>' + src + '</body></html>')
open(os.path.join(here, '_print.html'), 'w', encoding='utf-8').write(doc)
print('OK', len(src) // 1024, 'KB')
