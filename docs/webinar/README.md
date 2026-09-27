# Materi webinar KasirWarung AI

- `Webinar_KasirWarung_AI.html` — halaman interaktif (menu agenda + progres di kiri, mobile friendly, mode gelap).
- `Webinar_KasirWarung_AI.pdf` — handout A4, 15 halaman.
- `webinar.src.html` — sumber halaman; `img/` — screenshot aplikasi yang disisipkan.

Membangun ulang:

```bash
python3 docs/webinar/build.py docs/webinar/img          # sisipkan gambar → .html + _print.html
NODE_PATH=$(npm root -g) node docs/webinar/make_pdf.js  # cetak PDF (set FONT_DIR bila Google Fonts tidak terjangkau)
```
