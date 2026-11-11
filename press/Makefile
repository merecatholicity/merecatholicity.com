# Lérins Press: a static, single-page Lit site, apart from the main app.
# Its own npm project (package.json + package-lock.json here), its own dist/.
#
#   make run      build, then serve dist/ at http://127.0.0.1:$(PORT)/ and rebuild on a save
#   make build    build dist/ (PRESS_URL=... to build for another origin)
#   make check    type-check src/ and scripts/
#   make covers   make each cover's .jpg (feeds, link previews) from its .avif
#   make brand    cut the shield out of the logo and make the icons and the preview image
#   make deploy   build, then deploy dist/ to press.merecatholicity.com. CI's road
#                 (.github/workflows/press.yml): needs CLOUDFLARE_API_TOKEN.
#   make dry-run  build, then check the deploy without credentials (what a pull request runs)
#   make clean    remove dist/
PORT ?= 8090
export PORT

.PHONY: run build check covers brand deploy dry-run clean

node_modules/.package-lock.json: package.json package-lock.json
	npm ci --no-audit --no-fund
	@touch $@

build: node_modules/.package-lock.json
	node scripts/build.ts

run: build
	node scripts/serve.ts

check: node_modules/.package-lock.json
	npx tsc -p tsconfig.json

deploy: build
	npx wrangler deploy

dry-run: build
	npx wrangler deploy --dry-run

covers:
	@for f in content/covers/*.avif; do \
	  j="$${f%.avif}.jpg"; \
	  [ "$$j" -nt "$$f" ] || { magick "$$f" -strip -resize 800x -quality 85 "$$j" && echo "made $$j"; }; \
	done

# The owner's logo (content/brand/lerins-press-logo.jpg) is the source of every brand image.
# The shield is cut from its textured ground by a flood fill from the corners, which the
# shield's unbroken gold border stops. The link-preview image (1200x630) feathers the whole
# lockup onto a blurred stretch of the logo's own ground. Rerun after a new logo, and look.
LOGO := content/brand/lerins-press-logo.jpg
SHIELD := content/brand/shield.png
brand:
	magick $(LOGO) -crop 340x520+222+175 +repage -alpha set -fuzz 14% -fill none \
	  -draw "color 0,0 floodfill" -draw "color 339,0 floodfill" -draw "color 0,519 floodfill" \
	  -draw "color 339,519 floodfill" -draw "color 170,8 floodfill" -trim +repage -strip $(SHIELD)
	magick $(SHIELD) -resize x144 -strip -quality 90 static/brand/shield-144.webp
	magick $(SHIELD) -resize x400 -strip -quality 90 static/brand/shield-400.webp
	magick $(SHIELD) -resize 60x60 -gravity center -background none -extent 64x64 -strip static/favicon.png
	magick $(SHIELD) -resize 150x150 -gravity center -background '#0f1113' -extent 180x180 -strip static/apple-touch-icon.png
	magick $(LOGO) -crop 784x830+0+150 +repage -resize x610 \( +clone -fill black -colorize 100 \
	  -fill white -draw "rectangle 25,25 %[fx:w-25],%[fx:h-25]" -blur 0x18 \) -alpha off \
	  -compose CopyOpacity -composite png:- | magick $(LOGO) -crop 784x150+0+20 +repage \
	  -resize 1200x630\! -blur 0x30 png:- -gravity center -compose Over -composite -strip -quality 85 \
	  static/brand/og.jpg

clean:
	rm -rf dist
