# Architecture rules
- Catalog platform selection uses a validated query parameter on the existing catalog URL, so refresh and browser back restore the selected platform without changing hosting routes.
- Catalog navigation and banner visibility rules live in a small pure module with Node tests, so behavior can be verified without mounting the storefront.
