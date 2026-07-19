# Mere Catholicity

Source and website for [merecatholicity.com](https://merecatholicity.com).

The book is written in `confession.tex`. `./build-confession.sh` builds the PDF
(`Mere_Catholicity.pdf`), and `make html` builds the HTML edition (`book.html`).
`make publish` builds the KDP paperback interior (`Mere_Catholicity_Paperback.pdf`).
`make logos` builds the Logos/Verbum Personal Book edition (`Mere_Catholicity_Logos.docx`).
`make serve` serves the site locally on port 8000.

The site menu is defined in `nav.yml`. Edit it and run `make menu` to rebuild
the nav on every page.

## License

This repository is under the [MIT License](LICENSE), copyright
merecatholicity.com. That covers the website, the build system, the menu
system, and anything else not listed below.

The book itself, in its source and rendered forms, is dedicated to the
public domain under [Creative Commons CC0 1.0](LICENSE-CC0). No rights
reserved. This covers only:

- `confession.tex` (the book's source)
- `Mere_Catholicity.pdf` and `Mere_Catholicity_Paperback.pdf` (the renders)
- `book.html` (the web edition of the book)
- `Mere_Catholicity_Logos.docx` (the Logos/Verbum edition)
- `cover.jpg` and `book_cover.png` (the cover images)
