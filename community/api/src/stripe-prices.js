/**
 * Stripe Product and one-time Price per paid profile. Written by scripts/stripe-sync-prices.mjs.
 * Ids are not secrets. A missing entry, or an entry whose amount no longer matches the profile,
 * means checkout says the profile is not available yet.
 */
export const STRIPE_PROFILE_PRICES = {
  "test": {
    "beech-shimeji-bouquet": {
      "product": "prod_VVvm9qzVBFKCIC",
      "price": "price_1UUtv4JSH6QIItA55zFMZPmm",
      "amount_cents": 299
    },
    "chestnut-long-stem": {
      "product": "prod_VVvmvaEqIaMfOR",
      "price": "price_1UUtv4JSH6QIItA57eacpx3A",
      "amount_cents": 299
    },
    "cordyceps-high-color": {
      "product": "prod_VVvmPLyMv8jhgy",
      "price": "price_1UUtv5JSH6QIItA5FL67gCsc",
      "amount_cents": 399
    },
    "golden-oyster-deep-yellow": {
      "product": "prod_VVvmaAUnpCSnMl",
      "price": "price_1UUtv6JSH6QIItA5amIR2zok",
      "amount_cents": 299
    },
    "king-oyster-thick-stem": {
      "product": "prod_VVvm4SbJTmwIQq",
      "price": "price_1UUtv7JSH6QIItA5nh8ZNVE7",
      "amount_cents": 299
    },
    "lions-mane-dense-head": {
      "product": "prod_VVvmWebrhNIhSj",
      "price": "price_1UUtv7JSH6QIItA51TueETaH",
      "amount_cents": 399
    },
    "pearl-oyster-baby-clusters": {
      "product": "prod_VVvmkkOkKFFhIw",
      "price": "price_1UUtv8JSH6QIItA5NlZ7rmOc",
      "amount_cents": 299
    },
    "pearl-oyster-dark-cap": {
      "product": "prod_VVvm3UeUfuzYKK",
      "price": "price_1UUtv9JSH6QIItA5pVXgWwiE",
      "amount_cents": 299
    },
    "pink-oyster-bright": {
      "product": "prod_VVvm7he7N1dD7S",
      "price": "price_1UUtvAJSH6QIItA5ZI7jQ8PQ",
      "amount_cents": 299
    },
    "shiitake-donko": {
      "product": "prod_VVvmD6aH2VHCkQ",
      "price": "price_1UUtvAJSH6QIItA521bJEILk",
      "amount_cents": 299
    },
    "shiitake-flower-cap": {
      "product": "prod_VVvmH4k6oDHyLf",
      "price": "price_1UUtvBJSH6QIItA53QU7BcIA",
      "amount_cents": 399
    },
    "wood-ear-dark": {
      "product": "prod_VVvmJCe58m0GYa",
      "price": "price_1UUtvCJSH6QIItA5FNc9Oya6",
      "amount_cents": 299
    }
  },
  "live": {}
};
