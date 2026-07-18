# Mere Catholicity

Source and website for [merecatholicity.com](https://merecatholicity.com).

The book is written in `confession.tex`. `./build-confession.sh` builds the PDF
(`Mere_Catholicity.pdf`), and `make html` builds the HTML edition (`book.html`).
`make publish` builds the KDP paperback interior (`Mere_Catholicity_Paperback.pdf`).
`make serve` serves the site locally on port 8000.

The site menu is defined in `nav.yml`. Edit it and run `make menu` to rebuild
the nav on every page.

## License

The book and the website are dedicated to the public domain under
[Creative Commons CC0 1.0](LICENSE). No rights reserved. This covers:

- `confession.tex` (the book itself)
- `book.html`, `index.html`, `resources.html` (the web pages)
- `nav.html`, `footer.html`, `social.html` (page fragments used by the build)
- `style.css` and `nav.js`
- `Mere_Catholicity.pdf`
- `cover.jpg`

The build scripts are under the [MIT License](LICENSE-MIT). This covers:

- `Makefile`
- `build-confession.sh`
- `toc-prune.py`
- `nav.py` and `nav.yml`
