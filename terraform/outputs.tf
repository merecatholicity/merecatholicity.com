# The D1 databases' ids, printed after every apply (.github/workflows/terraform.yml). They are public
# by design: each stands in the wrangler.jsonc of the worker that binds it. Nothing sensitive is
# ever an output here; the state itself stays SECRET.
output "d1_ids" {
  value = {
    comments      = cloudflare_d1_database.comments.id
    library       = cloudflare_d1_database.library.id
    library_deep  = cloudflare_d1_database.library_deep.id
    library_deep2 = cloudflare_d1_database.library_deep2.id
    press_list    = cloudflare_d1_database.press_list.id
  }
}
