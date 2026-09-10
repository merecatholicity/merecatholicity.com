variable "account_id" {
  description = "Cloudflare account. Shared with four other zones — see README.md on blast radius."
  type        = string
  default     = "6093bc0889c95a08f0a92a8df6750c66"
}

variable "zone_id" {
  description = "The merecatholicity.com zone."
  type        = string
  default     = "2b270ffb21b7f98a39960abb6bf953ae"
}

variable "github_owner" {
  description = "GitHub org owning the site and private-shelf repositories."
  type        = string
  default     = "merecatholicity"
}

variable "private_shelf_deploy_key" {
  description = <<-EOT
    The PUBLIC half of the read-only deploy key the merecat workflow uses to clone
    the private shelf (2026-09-10). Empty = no key resource. The private half is the
    Actions secret PRIVATE_SHELF_DEPLOY_KEY on the site repository; the public half
    is public by nature and rides the Actions variable PRIVATE_SHELF_DEPLOY_PUBLIC_KEY,
    which terraform.yml hands in as TF_VAR_private_shelf_deploy_key.
  EOT
  type        = string
  default     = ""
}
