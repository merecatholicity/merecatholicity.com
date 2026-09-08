# Credentials come from the environment ONLY, never from a file in this repo:
#   CLOUDFLARE_API_TOKEN  - scoped token, see README.md for the permission list
#   GITHUB_TOKEN          - `gh auth token`, or a PAT with repo scope
#
# The backend additionally needs the R2 S3 credentials:
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

provider "cloudflare" {}

provider "github" {
  owner = var.github_owner
}
