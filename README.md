# Mere Catholicity

Source and website for [merecatholicity.com](https://merecatholicity.com).

The book is written in `confession.tex`. `./build-confession.sh` builds the PDF
(`Mere_Catholicity.pdf`), and `make html` builds the HTML edition (`book.html`).
`make serve` serves the site locally on port 8000.

## License

The book and the website are dedicated to the public domain under
[Creative Commons CC0 1.0](LICENSE). No rights reserved. This covers:

- `confession.tex` (the book itself)
- `book.html` and `index.html` (the web pages)
- `nav.html`, `footer.html`, `social.html` (page fragments used by the build)
- `style.css`
- `Mere_Catholicity.pdf`
- `cover.jpg`

The build scripts are under the [MIT License](LICENSE-MIT). This covers:

- `Makefile`
- `build-confession.sh`
- `toc-prune.py`
