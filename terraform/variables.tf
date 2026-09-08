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
