# Lérins Press: a static, single-page Lit site, apart from the main app.
# Its own npm project (package.json + package-lock.json here), its own dist/.
#
#   make run      build, then serve dist/ at http://127.0.0.1:$(PORT)/ and rebuild on a save
#   make build    build dist/ (PRESS_URL=... to build for another origin)
#   make check    type-check src/ and scripts/
#   make covers   make each cover's .jpg (feeds, link previews) from its .avif
#   make clean    remove dist/
PORT ?= 8090
export PORT

.PHONY: run build check covers clean

node_modules/.package-lock.json: package.json package-lock.json
	npm ci --no-audit --no-fund
	@touch $@

build: node_modules/.package-lock.json
	node scripts/build.ts

run: build
	node scripts/serve.ts

check: node_modules/.package-lock.json
	npx tsc -p tsconfig.json

covers:
	@for f in content/covers/*.avif; do \
	  j="$${f%.avif}.jpg"; \
	  [ "$$j" -nt "$$f" ] || { magick "$$f" -strip -resize 800x -quality 85 "$$j" && echo "made $$j"; }; \
	done

clean:
	rm -rf dist
